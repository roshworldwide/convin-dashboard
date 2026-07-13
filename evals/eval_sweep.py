"""RoshRegression across 10 reports — stability, win-rate, and drift.

One good day proves nothing. This runs the full holdout comparison independently on
ten report-days with different book sizes, connect rates, and balance mixes, and
answers three questions a bank's risk team will actually ask:

  1. STABILITY  — is the accuracy steady, or does it swing wildly day to day?
  2. WIN-RATE   — does it beat the incumbent playbook every single day, or just on
                  the day we happened to show them?
  3. DRIFT      — does the edge decay as conditions get worse?

Every day is an independent train/test cycle: 80% fit, 20% held out, no leakage.

    node evals/generate_reports.mjs && node evals/export_sweep.mjs
    python3 evals/eval_sweep.py
"""

from __future__ import annotations

import json
import pathlib
import statistics
import sys

from holdout import Case, Eval, run
from holdout.core.hashing import fingerprint
from holdout.core.target import Completion
from holdout.regression.compare import compare
from holdout.scorers import ExactMatch
from holdout.stats.power import minimum_detectable_effect, sd_diff_from_scores

HERE = pathlib.Path(__file__).parent
SWEEP = json.loads((HERE / "sweep" / "sweep.json").read_text())
REPORTS = json.loads((HERE / "reports" / "manifest.json").read_text())
NOTES = {d["day"]: d for d in REPORTS["days"]}

INCUMBENT = "rule-promise-to-pay"


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
    print(f"\n{'=' * 92}")
    print("  RoshRegression — 10-report validation sweep     [SYNTHETIC reports; real accounts]")
    print(f"{'=' * 92}\n")

    hdr = (f"{'Day':<4}{'book':>6}{'base':>7}{'conn':>7}  "
           f"{'RoshReg (95% CI)':<24}{'incumbent':>10}{'delta':>9}{'p':>11}  verdict")
    print(hdr)
    print("-" * len(hdr))

    rows = []
    for d in SWEEP["days"]:
        day = d["day"]
        cases = [json.loads(l) for l in
                 (HERE / "sweep" / f"cases_day{day}.jsonl").read_text().splitlines() if l]

        ev = Eval(f"rbl-day{day}",
                  [Case(input=c["input"], reference=c["reference"], id=c["id"]) for c in cases],
                  [ExactMatch()])

        def tgt(name):
            return Precomputed(name, {c["input"]: c["preds"][name] for c in cases},
                               {"day": day, "name": name,
                                "w": d["weights"] if name == "roshregression" else None})

        r_model = run(ev, target=tgt("roshregression"), seed=7)
        r_base = run(ev, target=tgt(INCUMBENT), seed=7)
        cmp = compare(r_base, r_model, alpha=0.05, seed=7)
        c = cmp.comparisons[0]

        m = r_model.metrics()["exact_match"]
        b = r_base.metrics()["exact_match"]
        verdict = {"improved": "WIN", "regressed": "LOSS",
                   "no_significant_change": "tie", "insufficient_data": "n/a"}[c.verdict]

        note = NOTES[day]
        ci = f"{m.value:.3f} [{m.ci_low:.3f},{m.ci_high:.3f}]"
        print(f"{day:<4}{len(cases):>6}{note['resolvedPct']:>6.1f}%{note['connectedPct']:>6.1f}%  "
              f"{ci:<24}{b.value:>10.3f}{c.result.effect:>+9.3f}{c.p_adjusted:>11.2g}  {verdict}")

        rows.append({"day": day, "acc": m.value, "base": b.value,
                     "delta": c.result.effect, "p": c.p_adjusted, "verdict": verdict,
                     "auc": d["auc"], "conn": note["connectedPct"],
                     "resolved": note["resolvedPct"], "note": note["note"],
                     "model_scores": r_model.case_scores("exact_match"),
                     "base_scores": r_base.case_scores("exact_match")})

    accs = [r["acc"] for r in rows]
    deltas = [r["delta"] for r in rows]
    wins = sum(r["verdict"] == "WIN" for r in rows)

    print(f"\n{'-' * 92}")
    print("  1. STABILITY")
    print(f"{'-' * 92}")
    print(f"  Accuracy across 10 reports:  mean {statistics.mean(accs):.3f}  "
          f"sd {statistics.stdev(accs):.3f}  range {min(accs):.3f}-{max(accs):.3f}")
    print(f"  AUC across 10 reports:       mean {statistics.mean([r['auc'] for r in rows]):.3f}  "
          f"sd {statistics.stdev([r['auc'] for r in rows]):.3f}")

    print(f"\n{'-' * 92}")
    print("  2. WIN-RATE vs the incumbent playbook ('chase whoever promised to pay')")
    print(f"{'-' * 92}")
    print(f"  Beat it on {wins} of {len(rows)} reports at a corrected alpha of 0.05.")
    print(f"  Mean edge: {statistics.mean(deltas):+.3f} "
          f"({statistics.mean(deltas) * 100:+.1f} accuracy points)  "
          f"sd {statistics.stdev(deltas):.3f}")
    worst = max(rows, key=lambda r: r["p"])
    print(f"  Weakest day: day {worst['day']} ({worst['note']}) — "
          f"delta {worst['delta']:+.3f}, p={worst['p']:.2g}")

    print(f"\n{'-' * 92}")
    print("  3. DRIFT — does the edge decay when conditions get worse?")
    print(f"{'-' * 92}")
    ranked = sorted(rows, key=lambda r: r["conn"])
    print(f"  {'day':<5}{'connect rate':>14}{'accuracy':>11}{'edge':>9}   condition")
    for r in ranked:
        print(f"  {r['day']:<5}{r['conn']:>13.1f}%{r['acc']:>11.3f}{r['delta']:>+9.3f}   {r['note']}")
    lo = [r for r in ranked[:3]]
    hi = [r for r in ranked[-3:]]
    print(f"\n  3 worst-connectivity days: mean accuracy {statistics.mean([r['acc'] for r in lo]):.3f}, "
          f"mean edge {statistics.mean([r['delta'] for r in lo]):+.3f}")
    print(f"  3 best-connectivity days:  mean accuracy {statistics.mean([r['acc'] for r in hi]):.3f}, "
          f"mean edge {statistics.mean([r['delta'] for r in hi]):+.3f}")

    # Pool every day into one big paired test — the headline claim.
    all_m, all_b = [], []
    for r in rows:
        ids = [k for k in r["model_scores"] if k in r["base_scores"]]
        all_m += [r["model_scores"][i] for i in ids]
        all_b += [r["base_scores"][i] for i in ids]
    sd = sd_diff_from_scores(all_b, all_m)
    pa = minimum_detectable_effect(n=len(all_m), sd_diff=sd, alpha=0.05, power=0.80)
    print(f"\n{'-' * 92}")
    print(f"  POOLED — {len(all_m)} held-out accounts across all 10 reports")
    print(f"{'-' * 92}")
    print(f"  RoshRegression {statistics.mean(all_m):.3f}   incumbent {statistics.mean(all_b):.3f}   "
          f"edge {statistics.mean(all_m) - statistics.mean(all_b):+.3f}")
    print(f"  At this n the eval can detect effects as small as {pa.mde * 100:.1f} accuracy points.\n")

    # The dashboard reads this. Nothing about the model's credentials is typed by
    # hand into the UI — if the model gets worse, the dashboard says so.
    llm = {}
    llm_path = HERE / "llm_sweep_results.json"
    if llm_path.exists():
        d = json.loads(llm_path.read_text())
        if d.get("rows"):
            llm = {
                "model": d["model"],
                "reports": len(d["rows"]),
                "modelAcc": statistics.mean(r["model"] for r in d["rows"]),
                "llmAcc": statistics.mean(r["llm"] for r in d["rows"]),
                "wins": sum(r["verdict"] == "RoshRegression WINS" for r in d["rows"]),
                "ties": sum(r["verdict"] == "TIE" for r in d["rows"]),
                "losses": sum(r["verdict"] == "LLM WINS" for r in d["rows"]),
            }

    out = {
        "model": SWEEP["model"],
        "synthetic": True,
        "reports": len(rows),
        "accuracyMean": statistics.mean(accs),
        "accuracySd": statistics.stdev(accs),
        "accuracyMin": min(accs),
        "accuracyMax": max(accs),
        "aucMean": statistics.mean(r["auc"] for r in rows),
        "aucSd": statistics.stdev(r["auc"] for r in rows),
        "wins": wins,
        "meanEdgePts": statistics.mean(deltas) * 100,
        "worstP": max(r["p"] for r in rows),
        "pooledN": len(all_m),
        "pooledModel": statistics.mean(all_m),
        "pooledIncumbent": statistics.mean(all_b),
        "mdePts": pa.mde * 100,
        "driftWorstDaysAcc": statistics.mean(r["acc"] for r in lo),
        "driftBestDaysAcc": statistics.mean(r["acc"] for r in hi),
        "llm": llm,
        "framework": "holdout — paired exact McNemar, BCa bootstrap CIs, Benjamini-Hochberg",
        "days": [{k: r[k] for k in ("day", "acc", "base", "delta", "p", "verdict", "auc",
                                    "conn", "resolved", "note")} for r in rows],
    }
    dest = HERE.parent / "src" / "data" / "validation.json"
    dest.write_text(json.dumps(out, indent=2))
    print(f"  -> {dest.relative_to(HERE.parent)}  (the dashboard reads this; nothing is hand-typed)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
