import type { AppConfig } from "../config.js";
import { decideNextStep } from "../fsm/engine.js";
import { isMeaningfulProblemText, parseInput } from "../fsm/input-parser.js";
import type {
  ConversationState,
  FsmDecision,
  ParsedInput,
  SkillMatch,
  UserSignal
} from "../fsm/types.js";
import {
  classifyFaqConfirmationWithAi,
  type FaqConfirmationLabel
} from "./ai-faq-classifier.js";
import { buildSkillResponseWithAi } from "../skills/ai-responder.js";
import { matchSkill, rankSkills } from "../skills/matcher.js";
import { selectSkillWithAi } from "../skills/ai-matcher.js";
import type { LoadedSkill } from "../skills/types.js";

export type OrchestratorInput = {
  content: string;
  currentState: ConversationState;
};

export type OrchestratorTrace = {
  source: "none" | "local" | "ai" | "state";
  localSkillId: string | null;
  localSkillScore: number | null;
  selectedSkillId: string | null;
  selectedSkillScore: number | null;
  aiSkillId: string | null;
  aiConfidence: number | null;
  aiReason: string | null;
  aiSkillResponseUsed: boolean;
  aiFaqLabel: FaqConfirmationLabel | null;
  aiFaqConfidence: number | null;
  aiFaqReason: string | null;
  topCandidates: Array<{ id: string; score: number }>;
};

export type OrchestratorResult = {
  decision: FsmDecision;
  trace: OrchestratorTrace;
};

export class ConversationOrchestrator {
  constructor(
    private readonly config: AppConfig,
    private readonly skills: LoadedSkill[]
  ) {}

  async run(input: OrchestratorInput): Promise<OrchestratorResult> {
    let parsedInput = parseInput(input.content);
    const faqSelection = await this.classifyFaqConfirmation(input, parsedInput);
    if (faqSelection.overrideSignal) {
      parsedInput = {
        ...parsedInput,
        signal: faqSelection.overrideSignal
      };
    }

    const skillSelection = await this.selectSkill(input);
    const enrichedSkillSelection = await this.enrichSkillResponse(input, skillSelection);
    const decision = decideNextStep(
      input.currentState,
      parsedInput,
      input.content,
      enrichedSkillSelection.skill
    );

    return {
      decision,
      trace: {
        ...enrichedSkillSelection.trace,
        aiFaqLabel: faqSelection.label,
        aiFaqConfidence: faqSelection.confidence,
        aiFaqReason: faqSelection.reason
      }
    };
  }

  private async enrichSkillResponse(
    input: OrchestratorInput,
    selection: { skill: SkillMatch | null; trace: OrchestratorTrace }
  ): Promise<{ skill: SkillMatch | null; trace: OrchestratorTrace }> {
    if (!selection.skill || !this.config.enableAiSkillResponse) {
      return selection;
    }

    const loadedSkill = this.skills.find(skill => skill.id === selection.skill?.id);
    if (!loadedSkill) {
      return selection;
    }

    const aiResponse = await buildSkillResponseWithAi({
      query: input.content,
      skill: loadedSkill,
      config: this.config
    });

    if (!aiResponse) {
      return selection;
    }

    return {
      skill: {
        ...selection.skill,
        response: aiResponse
      },
      trace: {
        ...selection.trace,
        aiSkillResponseUsed: true
      }
    };
  }

  private async classifyFaqConfirmation(
    input: OrchestratorInput,
    parsedInput: ParsedInput
  ): Promise<{
    overrideSignal: UserSignal | null;
    label: FaqConfirmationLabel | null;
    confidence: number | null;
    reason: string | null;
  }> {
    if (
      input.currentState.state !== "awaiting_faq_confirmation" ||
      !this.config.enableAiFaqConfirmation ||
      parsedInput.signal === "yes" ||
      parsedInput.signal === "no"
    ) {
      return {
        overrideSignal: null,
        label: null,
        confidence: null,
        reason: null
      };
    }

    const aiResult = await classifyFaqConfirmationWithAi({
      content: input.content,
      config: this.config
    });

    if (!aiResult) {
      return {
        overrideSignal: null,
        label: null,
        confidence: null,
        reason: null
      };
    }

    const overrideSignal =
      aiResult.confidence >= this.config.aiFaqMinConfidence &&
      (aiResult.label === "yes" || aiResult.label === "no")
        ? aiResult.label
        : null;

    return {
      overrideSignal,
      label: aiResult.label,
      confidence: aiResult.confidence,
      reason: aiResult.reason
    };
  }

  private async selectSkill(input: OrchestratorInput): Promise<{
    skill: SkillMatch | null;
    trace: OrchestratorTrace;
  }> {
    if (input.currentState.matchedSkillId) {
      const stateSkill = this.skills.find(skill => skill.id === input.currentState.matchedSkillId);
      if (stateSkill) {
        return {
          skill: {
            id: stateSkill.id,
            title: stateSkill.title,
            response: stateSkill.response,
            guidance: stateSkill.guidance,
            patterns: stateSkill.patterns,
            askEmail: stateSkill.askEmail,
            score: 1
          },
          trace: {
            ...emptyTrace(),
            source: "state",
            selectedSkillId: stateSkill.id,
            selectedSkillScore: 1
          }
        };
      }
    }

    const canEvaluateSkill =
      input.currentState.state === "awaiting_problem" ||
      input.currentState.state === "cold_start" ||
      input.currentState.state === "awaiting_email";

    if (!canEvaluateSkill || !isMeaningfulProblemText(input.content)) {
      return {
        skill: null,
        trace: emptyTrace()
      };
    }

    const ranked = rankSkills(input.content, this.skills);
    const rankedById = new Map(ranked.map(match => [match.id, match]));

    const aiCandidates = this.skills
      .map(skill => {
        const rankedMatch = rankedById.get(skill.id);
        if (rankedMatch) {
          return rankedMatch;
        }

        return {
          id: skill.id,
          title: skill.title,
          response: skill.response,
          guidance: skill.guidance,
          patterns: skill.patterns,
          askEmail: skill.askEmail,
          score: 0
        } as SkillMatch;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.aiSkillMaxCandidates);

    const localSkill = matchSkill(input.content, this.skills, this.config.skillsMinScore);

    let selectedSkill: SkillMatch | null = localSkill;
    let source: OrchestratorTrace["source"] = localSkill ? "local" : "none";
    let aiSkillId: string | null = null;
    let aiConfidence: number | null = null;
    let aiReason: string | null = null;

    if (this.config.enableAiSkillMatching && aiCandidates.length > 0) {
      const aiSelection = await selectSkillWithAi({
        query: input.content,
        candidates: aiCandidates,
        config: this.config
      });

      if (aiSelection) {
        aiSkillId = aiSelection.selectedSkillId;
        aiConfidence = aiSelection.confidence;
        aiReason = aiSelection.reason;

        if (
          aiSelection.selectedSkillId &&
          aiSelection.confidence >= this.config.aiSkillMinConfidence
        ) {
          const aiSkill = aiCandidates.find(
            candidate => candidate.id === aiSelection.selectedSkillId
          );
          if (aiSkill) {
            selectedSkill = aiSkill;
            source = "ai";
          }
        }
      }
    }

    return {
      skill: selectedSkill,
      trace: {
        source,
        localSkillId: localSkill?.id ?? null,
        localSkillScore: localSkill?.score ?? null,
        selectedSkillId: selectedSkill?.id ?? null,
        selectedSkillScore: selectedSkill?.score ?? null,
        aiSkillId,
        aiConfidence,
        aiReason,
        aiSkillResponseUsed: false,
        aiFaqLabel: null,
        aiFaqConfidence: null,
        aiFaqReason: null,
        topCandidates: aiCandidates.map(candidate => ({
          id: candidate.id,
          score: candidate.score
        }))
      }
    };
  }
}

function emptyTrace(): OrchestratorTrace {
  return {
    source: "none",
    localSkillId: null,
    localSkillScore: null,
    selectedSkillId: null,
    selectedSkillScore: null,
    aiSkillId: null,
    aiConfidence: null,
    aiReason: null,
    aiSkillResponseUsed: false,
    aiFaqLabel: null,
    aiFaqConfidence: null,
    aiFaqReason: null,
    topCandidates: []
  };
}
