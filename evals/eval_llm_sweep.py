"""RoshRegression vs Claude — head-to-head across all 10 reports, via the real API.

    export ANTHROPIC_API_KEY=sk-ant-...
    pip install "holdout[anthropic]"
    node evals/generate_reports.mjs && node evals/export_sweep.mjs
    python3 evals/eval_llm_sweep.py                  # all 10 reports
    python3 evals/eval_llm_sweep.py --day 1 --n 150  # one report, cheap

Why this matters
----------------
"Why not just use an LLM?" is the first question anyone technical will ask about
RoshRegression, and Convin — an AI company — cannot answer it with a shrug. This
settles it on real held-out accounts with a paired McNemar test.

The LLM is asked exactly what the model is asked: the account's features as prose,
and "Will this account be RECOVERED in this cycle?". Temperature 0. Same cases,
same scorer, same statistics.

Read the cost note before running the full sweep
------------------------------------------------
This makes one API call per account. All 10 reports is ~3,790 calls. Start with
`--day 1 --n 150` to sanity-check the wiring and the cost, then scale up.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import statistics
import sys

from holdout import Case, Eval, run
from holdout.core.hashing import fingerprint
from holdout.core.scoring import Score, Scorer
from holdout.core.target import Completion
from holdout.providers import Anthropic
from holdout.regression.compare import compare

HERE = pathlib.Path(__file__).parent
SWEEP = json.loads((HERE / "sweep" / "sweep.json").read_text())

MODEL = os.environ.get("HOLDOUT_MODEL", "claude-sonnet-4-6")
SYSTEM = (
    "You are a credit-collections analyst at an Indian bank. You will be shown one "
    "delinquent credit-card account and the record of an AI voice agent's attempts to "
    "reach the customer. Predict whether the account will be RECOVERED (fully paid) in "
    "this collection cycle. Answer with exactly one word: Resolved or Unresolved. "
    "No explanation, no punctuation."
)


class LabelMatch(Scorer):
    """ExactMatch, but tolerant of an LLM that says 'Resolved.' or 'resolved\n'.

    A model that gets the answer right but adds a full stop has not made a
    prediction error, and scoring it as one would understate the LLM and flatter
    RoshRegression. We are trying to find the truth here, not win.
    """

    requires_reference = True

    @property
    def name(self) -> str:
        return "exact_match"

    def config(self):
        return {"scorer": "label-match"}

    @staticmethod
    def _label(text: str) -> str:
        t = text.strip().lower()
        if "unresolved" in t:
            return "Unresolved"
        if "resolved" in t:
            return "Resolved"
        return "?"

    async def score(self, case: Case, output: str) -> Score:
        return Score(value=1.0 if self._label(output) == case.reference else 0.0, kind="binary")


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
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=int, help="run a single report day (1-10)")
    ap.add_argument("--n", type=int, default=0, help="cap cases per day (0 = all)")
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set. This script makes real API calls.", file=sys.stderr)
        return 2

    days = [d for d in SWEEP["days"] if args.day is None or d["day"] == args.day]
    total = 0
    rows = []

    print(f"\n{'=' * 88}")
    print(f"  RoshRegression  vs  {MODEL}   ·  real API, temperature 0")
    print(f"{'=' * 88}\n")

    for d in days:
        day = d["day"]
        cases = [json.loads(l) for l in
                 (HERE / "sweep" / f"cases_day{day}.jsonl").read_text().splitlines() if l]
        if args.n:
            cases = cases[:args.n]
        total += len(cases)

        ev = Eval(f"rbl-day{day}",
                  [Case(input=c["input"], reference=c["reference"], id=c["id"]) for c in cases],
                  [LabelMatch()])

        print(f"  Day {day}: {len(cases)} accounts -> {MODEL} ...", flush=True)
        r_llm = run(ev, target=Anthropic(MODEL, system=SYSTEM, temperature=0.0, max_tokens=8),
                    seed=7, max_concurrency=args.concurrency)

        r_model = run(ev, target=Precomputed(
            "roshregression",
            {c["input"]: c["preds"]["roshregression"] for c in cases},
            {"w": d["weights"], "b": d["bias"]}), seed=7)

        cmp = compare(r_llm, r_model, alpha=0.05, seed=7)
        c = cmp.comparisons[0]
        m, lm = r_model.metrics()["exact_match"], r_llm.metrics()["exact_match"]
        verdict = {"improved": "RoshRegression WINS", "regressed": "LLM WINS",
                   "no_significant_change": "TIE", "insufficient_data": "n/a"}[c.verdict]

        print(f"    RoshRegression {m.value:.3f} [{m.ci_low:.3f},{m.ci_high:.3f}]   "
              f"{MODEL} {lm.value:.3f} [{lm.ci_low:.3f},{lm.ci_high:.3f}]")
        print(f"    delta {c.result.effect:+.3f}  p={c.p_adjusted:.3g}  -> {verdict}\n")
        rows.append({"day": day, "model": m.value, "llm": lm.value,
                     "delta": c.result.effect, "p": c.p_adjusted, "verdict": verdict})

    if len(rows) > 1:
        wins = sum(r["verdict"] == "RoshRegression WINS" for r in rows)
        ties = sum(r["verdict"] == "TIE" for r in rows)
        losses = sum(r["verdict"] == "LLM WINS" for r in rows)
        print(f"{'-' * 88}")
        print(f"  ACROSS {len(rows)} REPORTS ({total} API calls)")
        print(f"{'-' * 88}")
        print(f"  RoshRegression wins: {wins}   ties: {ties}   losses: {losses}")
        print(f"  Mean accuracy — RoshRegression {statistics.mean([r['model'] for r in rows]):.3f}"
              f"   {MODEL} {statistics.mean([r['llm'] for r in rows]):.3f}")
        print(f"  Mean delta: {statistics.mean([r['delta'] for r in rows]):+.3f}\n")
        print("  Whatever this says, put it on the slide. If the LLM wins, Convin needs to")
        print("  know that before RBL's team finds out. If it doesn't, you have the single")
        print("  most disarming answer to 'why not just use GPT for this?'\n")

    (HERE / "llm_sweep_results.json").write_text(json.dumps(
        {"model": MODEL, "rows": rows}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
