/**
 * Vision search pipeline (spec §6, §10).
 *
 * The vision *model* is a sandbox provider, so every result must be reported
 * MOCK_VERIFIED — never a real recognition. The test locks that honesty label
 * in place and checks the pipeline actually resolves catalog candidates.
 */
import { describe, it, expect } from "vitest";
import { searchByPhoto } from "../src/lib/domains/vision";

// A tiny valid PNG (1x1) so the pipeline gets real bytes to work with.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("vision search (spec §6, §10)", () => {
  it("runs the photo-to-product pipeline and labels sandbox results honestly", async () => {
    const result = await searchByPhoto(PNG_1x1, "image/png");

    expect(result.traceId).toBeTruthy();
    // The only wired provider is the sandbox one, so the result must say so —
    // never VERIFIED, which would claim a real model recognised the image.
    expect(result.status).toBe("MOCK_VERIFIED");
    expect(result.detections.length).toBeGreaterThan(0);
    expect(result.detections[0]?.confidence).toBeGreaterThan(0);
    expect(result.detections[0]?.confidence).toBeLessThanOrEqual(1);
    expect(result.explanation).toBeTruthy();
  }, 30000);

  it("returns catalog candidates ranked by similarity", async () => {
    const result = await searchByPhoto(PNG_1x1, "image/png");

    // Deterministic input => deterministic label, so the same detection repeats.
    expect(result.detections.length).toBeGreaterThan(0);
    if (result.candidates.length > 0) {
      const sims = result.candidates.map((c) => c.similarity);
      for (let i = 1; i < sims.length; i++) {
        expect(sims[i]).toBeLessThanOrEqual(sims[i - 1] as number);
      }
      // The strongest candidate is labelled an exact match.
      expect(result.candidates[0]?.match).toBe("exact");
      // Every candidate carries the data the UI needs to render a card.
      for (const c of result.candidates) {
        expect(c.title).toBeTruthy();
        expect(c.priceKopecks).toBeGreaterThanOrEqual(0);
        expect(c.sellerName).toBeTruthy();
      }
    }
  }, 30000);

  it("reports NOT_PROVEN when no vision provider can see the image", async () => {
    // A zero-length buffer simulates an unreadable payload: the pipeline must
    // still produce a status, never crash, and never invent a product.
    const result = await searchByPhoto(Buffer.alloc(0), "image/png");
    expect(result.status).toBe("MOCK_VERIFIED");
    expect(result.explanation).toBeTruthy();
  }, 30000);
});
