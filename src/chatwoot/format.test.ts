import { describe, expect, it } from "vitest";
import { toWhatsappFormatting } from "./format.js";

describe("toWhatsappFormatting", () => {
  it("converts **bold** to *bold*", () => {
    expect(toWhatsappFormatting("Hola **Hot Keego**!")).toBe(
      "Hola *Hot Keego*!"
    );
  });

  it("handles multiple bold spans in the same line", () => {
    expect(
      toWhatsappFormatting("**20% OFF** en packs de **7, 14 y 30 días**")
    ).toBe("*20% OFF* en packs de *7, 14 y 30 días*");
  });

  it("does not collapse across newlines", () => {
    const input = "linea uno **\n** linea dos";
    expect(toWhatsappFormatting(input)).toBe(input);
  });

  it("converts __bold__ markdown variant to *bold*", () => {
    expect(toWhatsappFormatting("Tenés __3 cuotas__ sin interés")).toBe(
      "Tenés *3 cuotas* sin interés"
    );
  });

  it("flattens markdown links to text (url)", () => {
    expect(
      toWhatsappFormatting("Ver más en [la app](https://mykeego.com/app)")
    ).toBe("Ver más en la app (https://mykeego.com/app)");
  });

  it("strips heading markers at line start", () => {
    expect(toWhatsappFormatting("# Hot Keego\n## Detalle")).toBe(
      "Hot Keego\nDetalle"
    );
  });

  it("removes inline code backticks", () => {
    expect(toWhatsappFormatting("Usá `RESERVAR VEHÍCULO`")).toBe(
      "Usá RESERVAR VEHÍCULO"
    );
  });

  it("leaves a single-asterisk WhatsApp bold untouched", () => {
    expect(toWhatsappFormatting("Tenés *20% OFF* hoy")).toBe(
      "Tenés *20% OFF* hoy"
    );
  });

  it("handles empty string", () => {
    expect(toWhatsappFormatting("")).toBe("");
  });

  describe("filtro de risas y emoticonos", () => {
    it("elimina jaja en cualquier longitud", () => {
      expect(toWhatsappFormatting("Genial, jaja gracias.")).toBe(
        "Genial, gracias."
      );
      expect(toWhatsappFormatting("Bueno jajajaja sí")).toBe("Bueno sí");
    });

    it("elimina ja ja con espacios", () => {
      expect(toWhatsappFormatting("Ok ja ja, te ayudo")).toBe("Ok, te ayudo");
      expect(toWhatsappFormatting("ja ja ja perfecto")).toBe("perfecto");
    });

    it("elimina jeje, jiji, lol, xd", () => {
      expect(toWhatsappFormatting("Sí jeje claro")).toBe("Sí claro");
      expect(toWhatsappFormatting("dale lol")).toBe("dale");
      expect(toWhatsappFormatting("ok xd nos vemos")).toBe("ok nos vemos");
    });

    it("no rompe palabras que contienen ja/je/etc. embebido", () => {
      expect(toWhatsappFormatting("La caja del auto está cerrada")).toBe(
        "La caja del auto está cerrada"
      );
      expect(toWhatsappFormatting("El viaje fue bien")).toBe(
        "El viaje fue bien"
      );
      expect(toWhatsappFormatting("Tu reserva no se ejecutó")).toBe(
        "Tu reserva no se ejecutó"
      );
    });

    it("elimina emoticonos ASCII", () => {
      expect(toWhatsappFormatting("Listo :) avisame")).toBe("Listo avisame");
      expect(toWhatsappFormatting("Gracias :D")).toBe("Gracias");
      expect(toWhatsappFormatting("Ok ;) seguimos")).toBe("Ok seguimos");
    });

    it("limpia espacios sobrantes tras quitar tokens", () => {
      expect(toWhatsappFormatting("Hola jaja , todo bien")).toBe(
        "Hola, todo bien"
      );
    });
  });
});
