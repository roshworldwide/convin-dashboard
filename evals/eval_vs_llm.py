"""RoshRegression vs a frontier LLM — same cases, same scorer, paired test.

The LLM saw exactly what the model saw: the account's features as prose, and the
question "Will this account be RECOVERED in this cycle?". It did NOT see the labels.

Honest caveat, stated up front rather than buried: the LLM used here (Claude Opus
4.8) had prior exposure to this dataset's aggregate lift table — it knew the base
rate and knew that a promise-to-pay is a negative signal. A cold LLM would not.
That is an advantage to the LLM, not to RoshRegression. Any RoshRegression win is
therefore a conservative estimate of the true gap.

    python3 evals/eval_vs_llm.py
"""

from __future__ import annotations

import json
import pathlib
import sys

from holdout import Case, Eval, run
from holdout.core.hashing import fingerprint
from holdout.core.target import Completion
from holdout.regression.compare import compare
from holdout.scorers import ExactMatch

HERE = pathlib.Path(__file__).parent
ALL = {c["id"]: c for c in
       (json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines() if l)}
CARD = json.loads((HERE / "model_card.json").read_text())
LLM = json.loads((HERE / "llm_preds.json").read_text())
LLM_PREDS, LLM_NAME = LLM["preds"], LLM["_target"]

# Only the cases the LLM actually answered — a paired test needs identical cases.
CASES = [ALL[i] for i in LLM_PREDS if i in ALL]


class Precomputed:
    def __init__(self, name, answers, material):
        self._n, self._a = name, answers
        self._f = fingerprint({"t": name, "m": material})

    @property
    def name(self):
        return self._n

    @property
    def fingerprint(self):
        return self._f

    async def generate(self, prompt, *, seed=None):
        return Completion(text=self._a[prompt], model=self._n)


def main() -> int:
    ev = Eval(
        "rbl-recovery-prediction-120",
        [Case(input=c["input"], reference=c["reference"], id=c["id"]) for c in CASES],
        [ExactMatch()],
    )

    targets = {
        "roshregression": Precomputed(
            "roshregression",
            {c["input"]: c["preds"]["roshregression"] for c in CASES},
            {"w": CARD["weights"], "b": CARD["bias"]},
        ),
        LLM_NAME: Precomputed(
            LLM_NAME,
            {c["input"]: LLM_PREDS[c["id"]] for c in CASES},
            {"preds": LLM_PREDS},
        ),
        "rule-promise-to-pay": Precomputed(
            "rule-promise-to-pay",
            {c["input"]: c["preds"]["rule-promise-to-pay"] for c in CASES},
            {"rule": "ptp"},
        ),
        "majority-class": Precomputed(
            "majority-class",
            {c["input"]: c["preds"]["majority-class"] for c in CASES},
            {"rule": "majority"},
        ),
    }

    base = sum(c["reference"] == "Resolved" for c in CASES) / len(CASES)
    print(f"\n{'=' * 78}")
    print(f"  RoshRegression  vs  {LLM_NAME}")
    print(f"  {len(CASES)} held-out accounts · neither model trained on them")
    print(f"  True base rate: {base:.1%} resolved")
    print(f"{'=' * 78}\n")

    runs = {n: run(ev, target=t, seed=7) for n, t in targets.items()}

    print("ACCURACY\n")
    for n, r in sorted(runs.items(), key=lambda kv: -kv[1].metrics()["exact_match"].value):
        e = r.metrics()["exact_match"]
        print(f"  {n:<32} {e.value:.3f}  [95% CI {e.ci_low:.3f}, {e.ci_high:.3f}]")

    print(f"\n{'-' * 78}")
    print("  HEAD-TO-HEAD: does RoshRegression beat the LLM, or is it noise?")
    print(f"{'-' * 78}\n")

    cand = runs["roshregression"]
    for b in [LLM_NAME, "rule-promise-to-pay", "majority-class"]:
        cmp = compare(runs[b], cand, alpha=0.05, seed=7)
        c = cmp.comparisons[0]
        v = {"improved": "RoshRegression WINS", "regressed": "RoshRegression LOSES",
             "no_significant_change": "TIE (no significant difference)",
             "insufficient_data": "insufficient data"}[c.verdict]
        r = c.result
        print(f"  vs {b}")
        print(f"    {v}")
        print(f"    delta = {r.effect:+.3f}  [95% CI {r.ci.ci_low:+.3f}, {r.ci.ci_high:+.3f}]"
              f"   {c.baseline.value:.3f} -> {c.candidate.value:.3f}")
        print(f"    p = {c.p_adjusted:.4g}  ({r.test})  n = {c.n_pairs}\n")

    # Where did each one actually go wrong? Accuracy hides the shape of the error.
    print(f"{'-' * 78}")
    print("  ERROR SHAPE — accuracy alone hides which mistakes each system makes")
    print(f"{'-' * 78}\n")
    for n in ["roshregression", LLM_NAME]:
        preds = {c["id"]: (c["preds"]["roshregression"] if n == "roshregression"
                           else LLM_PREDS[c["id"]]) for c in CASES}
        tp = sum(1 for c in CASES if c["reference"] == "Resolved" and preds[c["id"]] == "Resolved")
        fn = sum(1 for c in CASES if c["reference"] == "Resolved" and preds[c["id"]] == "Unresolved")
        fp = sum(1 for c in CASES if c["reference"] == "Unresolved" and preds[c["id"]] == "Resolved")
        tn = sum(1 for c in CASES if c["reference"] == "Unresolved" and preds[c["id"]] == "Unresolved")
        rec = tp / (tp + fn) if tp + fn else 0
        prec = tp / (tp + fp) if tp + fp else 0
        print(f"  {n}")
        print(f"    caught {tp}/{tp + fn} of the accounts that actually paid  (recall {rec:.1%})")
        print(f"    of those it flagged, {prec:.1%} really paid            (precision {prec:.1%})")
        print(f"    missed {fn} payers · falsely flagged {fp} non-payers\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
