import assert from "node:assert/strict";
import { test } from "node:test";
import { openBranches } from "../src/github/branches";

const ref = (name: string, date: string, behindBy: number, aheadBy: number, pr?: { state: string; number: number }) => ({
  name,
  target: { committedDate: date, author: { name: "x", user: { login: "hx" } } },
  compare: { aheadBy, behindBy },
  associatedPullRequests: { nodes: pr ? [{ ...pr, isDraft: false, url: `u/${pr.number}` }] : [] },
});

test("只留未合入且最近有提交的分支", () => {
  const raw = {
    url: "https://github.com/a/b",
    defaultBranchRef: { name: "main" },
    refs: {
      nodes: [
        ref("main", "2026-11-20T00:00:00Z", 0, 0),
        ref("done", "2026-11-20T00:00:00Z", 0, 5),
        ref("squashed", "2026-11-20T00:00:00Z", 3, 5, { state: "MERGED", number: 1 }),
        ref("old", "2026-01-01T00:00:00Z", 2, 1),
        ref("feat", "2026-11-21T00:00:00Z", 4, 2, { state: "OPEN", number: 9 }),
        ref("wip", "2026-11-22T00:00:00Z", 1, 0),
      ],
    },
  };
  const r = openBranches("a/b", raw, Date.parse("2026-11-01T00:00:00Z"), (b) => (b === "feat" ? "failure" : undefined));
  assert.deepEqual(r.branches.map((b) => b.name), ["wip", "feat"]);
  const feat = r.branches[1]!;
  assert.equal(feat.ahead, 4);
  assert.equal(feat.behind, 2);
  assert.equal(feat.pr?.number, 9);
  assert.equal(feat.ci, "failure");
  assert.equal(feat.url, "https://github.com/a/b/tree/feat");
  assert.equal(r.defaultBranch, "main");
});
