import { detectAffirmation, isMeaningfulProblemText } from "./input-parser.js";
import type {
  ConversationState,
  FsmDecision,
  ParsedInput,
  SkillMatch,
  TemplateKey
} from "./types.js";

const MAX_UNKNOWN_ATTEMPTS = 2;

export function decideNextStep(
  currentState: ConversationState,
  parsedInput: ParsedInput,
  rawContent: string,
  skillMatch: SkillMatch | null
): FsmDecision {
  if (parsedInput.signal === "handoff") {
    return buildHandoffDecision({
      currentState,
      signal: parsedInput.signal,
      problem: currentState.problem
    });
  }

  if (currentState.state === "cold_start") {
    return handleColdStart(currentState, parsedInput, rawContent, skillMatch);
  }

  if (currentState.state === "awaiting_email") {
    return handleAwaitingEmail(currentState, parsedInput, rawContent, skillMatch);
  }

  if (currentState.state === "awaiting_faq_confirmation") {
    return handleFaqConfirmation(currentState, parsedInput, rawContent);
  }

  return handleProblem(currentState, parsedInput, rawContent, skillMatch);
}

function handleColdStart(
  currentState: ConversationState,
  parsedInput: ParsedInput,
  rawContent: string,
  skillMatch: SkillMatch | null
): FsmDecision {
  if (parsedInput.signal === "email" && parsedInput.email) {
    return buildReplyDecision({
      replyKey: "ASK_PROBLEM",
      nextState: "awaiting_problem",
      signal: parsedInput.signal,
      currentState,
      email: parsedInput.email,
      unknownAttempts: 0
    });
  }

  if (parsedInput.signal === "text" && isMeaningfulProblemText(rawContent)) {
    if (skillMatch) {
      if (shouldAskEmail(skillMatch, currentState)) {
        return buildSkillResolutionDecision(
          currentState,
          "no",
          currentState.problem ?? rawContent,
          skillMatch
        );
      }

      return buildSkillResolutionDecision(currentState, parsedInput.signal, rawContent, skillMatch);
    }

    return buildReplyDecision({
      replyKey: "ASK_PROBLEM",
      replyText:
        "Gracias por contarlo. Si podes, compartime un poco mas de detalle y te ayudo a derivarlo con el equipo.",
      nextState: "awaiting_problem",
      signal: parsedInput.signal,
      currentState,
      problem: rawContent.trim(),
      unknownAttempts: 0
    });
  }

  return buildReplyDecision({
    replyKey: "WELCOME_OPEN",
    nextState: "awaiting_problem",
    signal: parsedInput.signal,
    currentState,
    unknownAttempts: 0
  });
}

function handleAwaitingEmail(
  currentState: ConversationState,
  parsedInput: ParsedInput,
  rawContent: string,
  skillMatch: SkillMatch | null
): FsmDecision {
  if (parsedInput.signal === "email" && parsedInput.email) {
    if (skillMatch && currentState.problem) {
      return buildSkillResolutionDecision(
        {
          ...currentState,
          email: parsedInput.email
        },
        parsedInput.signal,
        currentState.problem,
        skillMatch
      );
    }

    return buildReplyDecision({
      replyKey: "ASK_PROBLEM",
      nextState: "awaiting_problem",
      signal: parsedInput.signal,
      currentState,
      email: parsedInput.email,
      unknownAttempts: 0
    });
  }

  if (parsedInput.signal === "no") {
    if (skillMatch && currentState.problem) {
      return buildSkillResolutionDecision(currentState, parsedInput.signal, currentState.problem, skillMatch);
    }

    return buildReplyDecision({
      replyKey: "ASK_PROBLEM_NO_EMAIL",
      nextState: "awaiting_problem",
      signal: parsedInput.signal,
      currentState,
      unknownAttempts: 0
    });
  }

  if (parsedInput.signal === "text" && isMeaningfulProblemText(rawContent)) {
    if (skillMatch) {
      if (shouldAskEmail(skillMatch, currentState)) {
        return buildReplyDecision({
          replyKey: "ASK_EMAIL_FOR_CASE",
          nextState: "awaiting_email",
          signal: parsedInput.signal,
          currentState,
          problem: rawContent.trim(),
          matchedSkillId: skillMatch.id,
          unknownAttempts: 0
        });
      }

      return buildSkillResolutionDecision(currentState, parsedInput.signal, rawContent, skillMatch);
    }

    return buildHandoffDecision({
      currentState,
      signal: parsedInput.signal,
      problem: rawContent.trim()
    });
  }

  return handleUnknown(currentState, {
    nextState: "awaiting_email",
    retryTemplate: "ASK_EMAIL_RETRY",
    signal: parsedInput.signal
  });
}

function handleProblem(
  currentState: ConversationState,
  parsedInput: ParsedInput,
  rawContent: string,
  skillMatch: SkillMatch | null
): FsmDecision {
  if (parsedInput.signal === "email" && parsedInput.email) {
    return buildReplyDecision({
      replyKey: "ASK_PROBLEM",
      nextState: "awaiting_problem",
      signal: parsedInput.signal,
      currentState,
      email: parsedInput.email,
      unknownAttempts: 0
    });
  }

  if (!isMeaningfulProblemText(rawContent)) {
    return handleUnknown(currentState, {
      nextState: "awaiting_problem",
      retryTemplate: "ASK_PROBLEM_RETRY",
      signal: parsedInput.signal
    });
  }

  if (skillMatch) {
    if (shouldAskEmail(skillMatch, currentState)) {
      return buildReplyDecision({
        replyKey: "ASK_EMAIL_FOR_CASE",
        nextState: "awaiting_email",
        signal: parsedInput.signal,
        currentState,
        problem: rawContent.trim(),
        matchedSkillId: skillMatch.id,
        unknownAttempts: 0
      });
    }

    return buildSkillResolutionDecision(currentState, parsedInput.signal, rawContent, skillMatch);
  }

  return buildHandoffDecision({
    currentState,
    signal: parsedInput.signal,
    problem: rawContent.trim()
  });
}

function handleFaqConfirmation(
  currentState: ConversationState,
  parsedInput: ParsedInput,
  rawContent: string
): FsmDecision {
  const inferred =
    parsedInput.signal === "yes" || parsedInput.signal === "no"
      ? parsedInput.signal
      : detectAffirmation(rawContent);

  if (inferred === "yes") {
    return buildReplyDecision({
      replyKey: "FAQ_HELPED",
      replyText:
        "Perfecto, me alegra que haya servido. Si necesitas algo mas, escribinos cuando quieras.",
      nextState: "cold_start",
      signal: "yes",
      currentState,
      unknownAttempts: 0,
      problem: null,
      matchedSkillId: null
    });
  }

  if (inferred === "no") {
    return buildHandoffDecision({
      currentState,
      signal: "no",
      problem: currentState.problem
    });
  }

  if (parsedInput.signal === "text" && isMeaningfulProblemText(rawContent)) {
    return buildHandoffDecision({
      currentState,
      signal: "no",
      problem: rawContent.trim()
    });
  }

  return handleUnknown(currentState, {
    nextState: "awaiting_faq_confirmation",
    retryTemplate: "FAQ_CONFIRM_RETRY",
    signal: parsedInput.signal
  });
}

function buildSkillResolutionDecision(
  currentState: ConversationState,
  signal: ParsedInput["signal"],
  rawContent: string,
  skill: SkillMatch
): FsmDecision {
  return buildReplyDecision({
    replyKey: "FAQ_HELPED",
    replyText: `${skill.response}\n\nEsto te ayudo a resolverlo? Responde si o no para seguir.`,
    nextState: "awaiting_faq_confirmation",
    signal,
    currentState,
    problem: rawContent.trim(),
    matchedSkillId: skill.id,
    unknownAttempts: 0
  });
}

function shouldAskEmail(skill: SkillMatch, currentState: ConversationState): boolean {
  return skill.askEmail && !currentState.email;
}

function handleUnknown(
  currentState: ConversationState,
  options: {
    nextState: ConversationState["state"];
    retryTemplate: "ASK_EMAIL_RETRY" | "ASK_PROBLEM_RETRY" | "FAQ_CONFIRM_RETRY";
    signal: ParsedInput["signal"];
  }
): FsmDecision {
  const nextUnknownAttempts = currentState.unknownAttempts + 1;
  if (nextUnknownAttempts >= MAX_UNKNOWN_ATTEMPTS) {
    return buildHandoffDecision({
      currentState,
      signal: options.signal,
      problem: currentState.problem
    });
  }

  return buildReplyDecision({
    replyKey: options.retryTemplate,
    nextState: options.nextState,
    signal: options.signal,
    currentState,
    unknownAttempts: nextUnknownAttempts
  });
}

function buildHandoffDecision(params: {
  currentState: ConversationState;
  signal: ParsedInput["signal"];
  problem: string | null;
}): FsmDecision {
  const { currentState, signal, problem } = params;
  return {
    action: "handoff",
    replyKey: "HANDOFF_HUMAN",
    replyText: null,
    nextState: "handoff_active",
    unknownAttempts: 0,
    signal,
    isUser: currentState.isUser,
    email: currentState.email,
    problem,
    matchedSkillId: currentState.matchedSkillId,
    addAgentNote: true
  };
}

function buildReplyDecision(params: {
  replyKey: TemplateKey;
  replyText?: string;
  nextState: ConversationState["state"];
  signal: ParsedInput["signal"];
  currentState: ConversationState;
  unknownAttempts: number;
  email?: string | null;
  problem?: string | null;
  matchedSkillId?: string | null;
}): FsmDecision {
  const {
    replyKey,
    replyText,
    nextState,
    signal,
    currentState,
    unknownAttempts,
    email,
    problem,
    matchedSkillId
  } = params;

  return {
    action: "reply",
    replyKey,
    replyText: replyText ?? null,
    nextState,
    unknownAttempts,
    signal,
    isUser: currentState.isUser,
    email: email ?? currentState.email,
    problem: problem ?? currentState.problem,
    matchedSkillId: matchedSkillId ?? currentState.matchedSkillId,
    addAgentNote: false
  };
}
