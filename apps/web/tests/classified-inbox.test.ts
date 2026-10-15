import { describe, expect, it } from "vitest";
import { replyThreadRef, type ReplyRow } from "../src/lib/domains/classified-inbox";

const row = (r: Partial<ReplyRow>): ReplyRow => ({ userId: "", kind: "", url: null, body: "текст", createdAt: new Date(), readAt: null, ...r });

describe("отклики на объявления в «Сообщениях»", () => {
  it("автор видит каждого откликнувшегося отдельной перепиской", () => {
    const myAds = new Set(["ad1"]);
    const incoming = replyThreadRef(row({ userId: "me", kind: "classified_reply", url: "/classifieds/ad1/replies/bob" }), "me", myAds);
    expect(incoming).toEqual({ key: "ad1:bob", adId: "ad1", applicantId: "bob", href: "/classifieds/ad1/replies/bob", incoming: true });
    const myAnswer = replyThreadRef(row({ userId: "bob", kind: "classified_answer", url: "/classifieds/ad1/chat" }), "me", myAds);
    expect(myAnswer).toEqual({ key: "ad1:bob", adId: "ad1", applicantId: "bob", href: "/classifieds/ad1/replies/bob", incoming: false });
  });

  it("откликнувшийся видит одну переписку с автором", () => {
    const none = new Set<string>();
    const mine = replyThreadRef(row({ userId: "alice", kind: "classified_reply", url: "/classifieds/ad2/replies/me" }), "me", none);
    expect(mine).toEqual({ key: "ad2:author", adId: "ad2", applicantId: null, href: "/classifieds/ad2/chat", incoming: false });
    const answer = replyThreadRef(row({ userId: "me", kind: "classified_answer", url: "/classifieds/ad2/chat" }), "me", none);
    expect(answer).toEqual({ key: "ad2:author", adId: "ad2", applicantId: null, href: "/classifieds/ad2/chat", incoming: true });
  });

  it("чужие сообщения и другие уведомления не попадают", () => {
    const myAds = new Set(["ad1"]);
    expect(replyThreadRef(row({ userId: "carol", kind: "classified_answer", url: "/classifieds/ad9/chat" }), "me", myAds)).toBeNull();
    expect(replyThreadRef(row({ userId: "me", kind: "seller_message", url: "/messages/s1" }), "me", myAds)).toBeNull();
    expect(replyThreadRef(row({ userId: "me", kind: "classified_reply", url: "/classifieds/ad1/replies/me" }), "me", myAds)).toBeNull();
    expect(replyThreadRef(row({ userId: "me", kind: "classified_reply", url: "/classifieds/ad1/other" }), "me", myAds)).toBeNull();
  });
});
