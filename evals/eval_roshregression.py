"""Evaluate RoshRegression with `holdout` (github.com/roshworldwide/holdout).

Why this file exists
--------------------
`eval_model.mjs` reports a point estimate: "AUC 0.756". That is exactly the kind of
vanity number holdout was built to distrust. It cannot tell you whether
RoshRegression genuinely beats the rule RBL's collections team uses today, or
whether the gap is noise on a 382-account sample.

So we pose it as a paired comparison on identical, previously-unseen cases:

    baseline  = rule-promise-to-pay   (the incumbent collections playbook)
    candidate = RoshRegression

and let holdout answer with an exact McNemar test, a 95% CI on the difference, a
Benjamini-Hochberg-corrected p-value, and a power analysis that says whether the
sample was even large enough to trust a null result.

Leakage discipline
------------------
RoshRegression is refitted per batch in production. Scoring it on its own training
rows would be contamination. `export_cases.mjs` therefore cuts a deterministic 20%
holdout FIRST and fits only on the remaining 80% — every case scored here is an
account the model has never seen.

    node evals/export_cases.mjs && python3 evals/eval_roshregression.py
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
from holdout.stats.power import minimum_detectable_effect, sd_diff_from_scores

HERE = pathlib.Path(__file__).parent
CASES = [json.loads(line) for line in (HERE / "cases.jsonl").read_text().splitlines() if line]
CARD = json.loads((HERE / "model_card.json").read_text())


class PrecomputedTarget:
    """A holdout Target backed by a scoring function that already ran in Node.

    RoshRegression ships as JavaScript inside the dashboard's ingest path. Rather
    than re-implement it in Python — which would evaluate a *copy* of the model
    rather than the one RBL actually runs — we score in Node and serve the results
    through this Target. The fingerprint is derived from the fitted weights, so any
    refit or feature change produces a different run hash, exactly as holdout
    requires.
    """

    def __init__(self, name: str, answers: dict[str, str], fp_material: object) -> None:
        self._name = name
        self._answers = answers
        self._fp = fingerprint({"target": name, "material": fp_material})

    @property
    def name(self) -> str:
        return self._name

    @property
    def fingerprint(self) -> str:
        return self._fp

    async def generate(self, prompt: str, *, seed: int | None = None) -> Completion:
        return Completion(text=self._answers[prompt], model=self._name)


def build(name: str) -> PrecomputedTarget:
    answers = {c["input"]: c["preds"][name] for c in CASES}
    material = (
        {"weights": CARD["weights"], "bias": CARD["bias"], "version": CARD["version"]}
        if name == "roshregression"
        else {"rule": name}
    )
    return PrecomputedTarget(name, answers, material)


def main() -> int:
    ev = Eval(
        "rbl-recovery-prediction",
        [Case(input=c["input"], reference=c["reference"], id=c["id"]) for c in CASES],
        [ExactMatch()],
    )

    base_rate = sum(c["reference"] == "Resolved" for c in CASES) / len(CASES)
    print(f"\n{'=' * 78}")
    print(f"  {CARD['model']} v{CARD['version']}  ·  evaluated with holdout")
    print(f"  Fit on {CARD['trainedOn']} accounts · scored on {CARD['heldOut']} NEVER-SEEN accounts")
    print(f"  Holdout base rate: {base_rate:.1%} resolved")
    print(f"{'=' * 78}\n")

    names = ["roshregression", "rule-promise-to-pay", "rule-connected-call",
             "rule-talked-2min", "majority-class"]
    runs = {n: run(ev, target=build(n), seed=7) for n in names}

    print("ACCURACY — every score with its confidence interval, never without\n")
    for n in names:
        est = runs[n].metrics()["exact_match"]
        star = "   <-- the model" if n == "roshregression" else ""
        print(f"  {n:<22} {est.value:.3f}  [95% CI {est.ci_low:.3f}, {est.ci_high:.3f}]"
              f"  ({est.method}){star}")

    print(f"\n{'-' * 78}")
    print("  THE QUESTION THAT MATTERS")
    print("  Does RoshRegression actually beat the rule RBL's team uses today,")
    print("  or is the gap just noise?")
    print(f"{'-' * 78}\n")

    cand = runs["roshregression"]
    for baseline_name in ["rule-promise-to-pay", "rule-connected-call",
                          "rule-talked-2min", "majority-class"]:
        cmp = compare(runs[baseline_name], cand, alpha=0.05, seed=7)
        c = cmp.comparisons[0]
        verdict = {
            "improved": "SIGNIFICANT IMPROVEMENT",
            "regressed": "REGRESSED",
            "no_significant_change": "no significant difference",
            "insufficient_data": "insufficient data",
        }.get(c.verdict, c.verdict)
        r = c.result
        print(f"  vs {baseline_name}")
        print(f"    {verdict}")
        print(f"    delta = {r.effect:+.3f}  "
              f"[95% CI {r.ci.ci_low:+.3f}, {r.ci.ci_high:+.3f}]"
              f"   {c.baseline.value:.3f} -> {c.candidate.value:.3f}")
        print(f"    p = {c.p_adjusted:.4g}  ({r.test}, {cmp.correction}-corrected)  "
              f"n = {c.n_pairs}\n")
        for w in cmp.warnings:
            print(f"    ! {w}")

    # Was the sample even big enough? A null result from an underpowered eval is not
    # evidence of safety — holdout is explicit about this, so we report it unasked.
    a = runs["rule-promise-to-pay"].case_scores("exact_match")
    b = cand.case_scores("exact_match")
    ids = [k for k in a if k in b]
    sd = sd_diff_from_scores([a[i] for i in ids], [b[i] for i in ids])
    pa = minimum_detectable_effect(n=len(ids), sd_diff=sd, alpha=0.05, power=0.80)
    print(f"{'-' * 78}")
    print(f"  POWER — with n={pa.n} paired cases (sd of paired diffs = {pa.sd_diff:.3f}),")
    print(f"  the smallest true difference this eval could reliably detect is")
    print(f"  {pa.mde:.3f} = {pa.mde * 100:.1f} accuracy points "
          f"(alpha={pa.alpha}, power={pa.power}).")
    print(f"  A 'no significant change' below that is NOT evidence of safety.")
    print(f"{'-' * 78}\n")

    print(f"  run hash (RoshRegression): {cand.run_id}")
    print("  Same weights + same cases => same hash. Refit the model and it changes.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
