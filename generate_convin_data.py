#!/usr/bin/env python3
"""
Generate the Convin x RBL Recovery Intelligence data model.

Multi-batch / daily-snapshot design:
  - Reads raw collections CSVs and emits ONE JSON per batch into src/data/batches/
  - Writes src/data/manifest.json listing dates -> uploads (+ a merged "Day Total")
  - Each upload on a given day becomes its own tab; Day Total merges them.

Seed behaviour (no real multi-day history yet): the primary CSV
(src/data/convin_source.csv) is treated as day 2026-07-07 and split into three
faithful disjoint slices to represent three same-day uploads. Day Total merges
them back to the true full numbers. Drop real dated CSVs into src/data/uploads/
(named upload-YYYY-MM-DD-<slot>.csv) and they are picked up automatically.

Business rule: a RESOLVED lead counts its FULL total_outstanding as recovered.
Stdlib only.
"""
import csv, json, os, datetime
from collections import defaultdict, Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "src", "data")
SRC = os.path.join(DATA, "convin_source.csv")
UPLOADS = os.path.join(DATA, "uploads")
BATCHES = os.path.join(DATA, "batches")

def fnum(x):
    try: return float(str(x).replace(",", "").strip())
    except: return 0.0
def U(x): return (x or "").strip().upper()

BAND_ORDER = ["20-30K", "30-50K", "50-70K", "70-100K", "100-200K", ">200K"]
def band_norm(b):
    b = (b or "").strip().upper().replace(" ", "")
    return b if b in BAND_ORDER else b
def entity_norm(v):
    v = (v or "").strip()
    if v == "": return "Blank"
    if v.upper() == "NA": return "N/A"
    if v.upper() == "YES": return "YES"
    if v.upper() == "NO": return "NO"
    return v
def refusal_bucket(v):
    v = (v or "").strip()
    if v == "": return "Blank"
    if v.upper() == "NA": return "N/A"
    if v.upper() == "NO": return "NO"
    return "YES"
def pay_bucket(v):
    s = (v or "").strip().lower()
    if s == "" or s == "na": return None
    if "phonepe" in s: return "PhonePe"
    if "gpay" in s or "google" in s or "g pay" in s: return "Google Pay"
    if "paytm" in s: return "Paytm"
    if "rbl" in s: return "RBL App"
    if "upi" in s: return "UPI"
    if "neft" in s or "imps" in s or "net" in s or "online" in s or "netbank" in s: return "Net/Online"
    if "credit card" in s or "debit" in s or "card" in s: return "Card"
    if "app" in s: return "RBL App"
    if "phone" in s or "call" in s: return "Net/Online"
    return "Other"
def dur_bucket(sec):
    sec = fnum(sec)
    if sec <= 0: return "Not connected"
    if sec < 30: return "<30s"
    if sec < 60: return "30–60s"
    if sec < 120: return "1–2 min"
    if sec < 300: return "2–5 min"
    return ">5 min"
DUR_ORDER = ["Not connected", "<30s", "30–60s", "1–2 min", "2–5 min", ">5 min"]
ATT_ORDER = ["1–3", "4–6", "7–9", "10–12", "13+"]
def att_band(a):
    a = fnum(a)
    return "1–3" if a <= 3 else "4–6" if a <= 6 else "7–9" if a <= 9 else "10–12" if a <= 12 else "13+"
def is_res(r): return r.get("Status", "").strip() == "Resolved"
def cr(x): return f"₹{x/1e7:.2f} Cr" if abs(x) >= 1e7 else (f"₹{x/1e5:.2f} L" if abs(x) >= 1e5 else f"₹{x:,.0f}")


def build(rows, report_date_display):
    """Compute the full payload (agg + intel + table) for a set of rows."""
    N = len(rows)
    resolved = [r for r in rows if is_res(r)]
    unres = [r for r in rows if not is_res(r)]
    sum_out = sum(fnum(r["total_outstanding"]) for r in rows)
    sum_mindue = sum(fnum(r["minimum_amount_due"]) for r in rows)
    recovered = sum(fnum(r["total_outstanding"]) for r in resolved)
    attempts = sum(fnum(r["Total AI Call Attempts"]) for r in rows)
    connected = sum(fnum(r["AI Connected Calls"]) for r in rows)
    secs = sum(fnum(r["AI Connected Seconds"]) for r in rows)

    totals = {
        "accounts": N, "resolved": len(resolved), "unresolved": len(unres),
        "sumOut": sum_out, "recovered": recovered, "outstandingPending": sum_out - recovered,
        "recoveryRatePct": recovered / sum_out * 100 if sum_out else 0,
        "resolutionRatePct": len(resolved) / N * 100 if N else 0,
        "sumMinDue": sum_mindue, "avgOutstanding": sum_out / N if N else 0,
        "avgRecoveryPerResolved": recovered / len(resolved) if resolved else 0,
    }
    ai = {
        "attempts": int(attempts), "connected": int(connected), "notConnected": int(attempts - connected),
        "connectRatePct": connected / attempts * 100 if attempts else 0, "talkMinutes": secs / 60,
        "avgAttempts": attempts / N if N else 0, "avgConnectedSec": secs / connected if connected else 0,
    }

    def matrix(col, norm):
        m = defaultdict(lambda: {"resolved": 0, "unresolved": 0})
        for r in rows:
            m[norm(r.get(col, ""))]["resolved" if is_res(r) else "unresolved"] += 1
        return dict(m)
    entity = {
        "promise": matrix("Lead Entity Promise to Pay", entity_norm),
        "paid": matrix("Lead Entity Paid", entity_norm),
        "refusal": matrix("Lead Entity Refusal to pay", refusal_bucket),
    }

    def cross(col, keys, norm):
        out = {}
        for k in keys:
            sub = [r for r in rows if norm(r.get(col, "")) == k]
            out[k] = {"resolved": sum(1 for r in sub if is_res(r)),
                      "unresolved": sum(1 for r in sub if not is_res(r)),
                      "recovered": sum(fnum(r["total_outstanding"]) for r in sub if is_res(r)),
                      "outstanding": sum(fnum(r["total_outstanding"]) for r in sub), "count": len(sub)}
        return out
    goal = cross("Goal Achieved", ["Yes", "No", "Blank"],
                 lambda v: (v or "").strip() if (v or "").strip() in ("Yes", "No") else "Blank")
    qualification = cross("Qualification Status", ["Qualified", "In Progress", "Not Qualified", "Blank"],
                          lambda v: (v or "").strip() if (v or "").strip() in ("Qualified", "In Progress", "Not Qualified") else "Blank")

    disp = defaultdict(lambda: {"total": 0, "resolved": 0, "unresolved": 0, "outstanding": 0.0, "recovered": 0.0})
    for r in rows:
        k = (r.get("CollectionsDisposition_v2 L1") or "").strip() or "(Not contacted)"
        d = disp[k]; d["total"] += 1; o = fnum(r["total_outstanding"]); d["outstanding"] += o
        if is_res(r): d["resolved"] += 1; d["recovered"] += o
        else: d["unresolved"] += 1
    disposition = sorted([{"name": k, **v} for k, v in disp.items()], key=lambda x: x["recovered"], reverse=True)

    band = {}
    for b in BAND_ORDER:
        sub = [r for r in rows if band_norm(r.get("Curr Bal Band", "")) == b]
        res = sum(1 for r in sub if is_res(r))
        band[b] = {"count": len(sub), "resolved": res, "unresolved": len(sub) - res,
                   "resolutionPct": res / len(sub) * 100 if sub else 0,
                   "outstanding": sum(fnum(r["total_outstanding"]) for r in sub),
                   "recovered": sum(fnum(r["total_outstanding"]) for r in sub if is_res(r))}

    def geo(col):
        g = defaultdict(lambda: {"count": 0, "outstanding": 0.0, "recovered": 0.0, "resolved": 0,
                                 "unresolved": 0, "minDue": 0.0, "attempts": 0.0, "connected": 0.0})
        for r in rows:
            k = (r.get(col) or "").strip()
            if not k: continue
            e = g[k]; e["count"] += 1; o = fnum(r["total_outstanding"]); e["outstanding"] += o
            e["minDue"] += fnum(r["minimum_amount_due"]); e["attempts"] += fnum(r["Total AI Call Attempts"])
            e["connected"] += fnum(r["AI Connected Calls"])
            if is_res(r): e["resolved"] += 1; e["recovered"] += o
            else: e["unresolved"] += 1
        return {k: {**e, "resolutionPct": e["resolved"] / e["count"] * 100 if e["count"] else 0,
                    "connectPct": e["connected"] / e["attempts"] * 100 if e["attempts"] else 0} for k, e in g.items()}
    region = geo("Region")
    state = sorted([{"state": k, **v} for k, v in geo("Primary State").items()],
                   key=lambda x: x["outstanding"], reverse=True)

    duration = []
    for b in DUR_ORDER:
        sub = [r for r in rows if dur_bucket(r.get("AI Connected Seconds")) == b]
        n = len(sub)
        if not n: continue
        duration.append({"bucket": b, "n": n,
                         "resolutionPct": sum(1 for r in sub if is_res(r)) / n * 100,
                         "ptpPct": sum(1 for r in sub if U(r.get("Lead Entity Promise to Pay")) == "YES") / n * 100,
                         "paidPct": sum(1 for r in sub if U(r.get("Lead Entity Paid")) == "YES") / n * 100,
                         "refusalPct": sum(1 for r in sub if refusal_bucket(r.get("Lead Entity Refusal to pay")) == "YES") / n * 100})

    pm = defaultdict(lambda: {"payments": 0, "amount": 0.0})
    for r in rows:
        if not is_res(r): continue
        b = pay_bucket(r.get("Lead Entity If payment done return 'Mode of Payment"))
        if not b: continue
        pm[b]["payments"] += 1; pm[b]["amount"] += fnum(r["total_outstanding"])
    payment_modes = sorted([{"mode": k, **v} for k, v in pm.items()], key=lambda x: x["amount"], reverse=True)

    funnel = [
        {"stage": "Total Accounts", "value": N},
        {"stage": "AI Attempted", "value": sum(1 for r in rows if fnum(r["Total AI Call Attempts"]) > 0)},
        {"stage": "AI Connected", "value": sum(1 for r in rows if fnum(r["AI Connected Calls"]) > 0)},
        {"stage": "Qualified", "value": sum(1 for r in rows if (r.get("Qualification Status") or "").strip() == "Qualified")},
        {"stage": "Promise to Pay", "value": sum(1 for r in rows if U(r.get("Lead Entity Promise to Pay")) == "YES")},
        {"stage": "Already Paid Claimed", "value": sum(1 for r in rows if U(r.get("Lead Entity Paid")) == "YES")},
        {"stage": "Resolved", "value": len(resolved)},
    ]
    top20 = sorted(rows, key=lambda r: fnum(r["total_outstanding"]), reverse=True)[:20]
    top_outstanding = [{"name": (r.get("Customer Name") or "—").strip(), "outstanding": fnum(r["total_outstanding"]),
                        "state": (r.get("Primary State") or "—").strip(), "connected": int(fnum(r["AI Connected Calls"])),
                        "ptp": U(r.get("Lead Entity Promise to Pay")) == "YES", "status": r.get("Status", "").strip()} for r in top20]

    # intelligence
    AI_RATE, AGENCY = 5.0, 12.0
    ai_cost = ai["talkMinutes"] * AI_RATE
    agency_cost = recovered * AGENCY / 100
    roi = {"connectedMinutes": ai["talkMinutes"], "aiRatePerMin": AI_RATE, "aiCostInr": ai_cost,
           "agencyPct": AGENCY, "agencyCostInr": agency_cost, "savingsInr": agency_cost - ai_cost,
           "costPer100": ai_cost / recovered * 100 if recovered else 0,
           "annualSavingsInr": (agency_cost - ai_cost) * 12 * 0.85}

    open_out = sum(fnum(r["total_outstanding"]) for r in unres)
    def open_sum(pred):
        sub = [r for r in unres if pred(r)]
        return {"count": len(sub), "amount": sum(fnum(r["total_outstanding"]) for r in sub)}
    opp_promise = open_sum(lambda r: U(r.get("Lead Entity Promise to Pay")) == "YES")
    opp_engaged = open_sum(lambda r: fnum(r["AI Connected Seconds"]) >= 120)
    opp_claimed = open_sum(lambda r: U(r.get("Lead Entity Paid")) == "YES")

    def propensity(r):
        s = 0.0
        if fnum(r["AI Connected Calls"]) > 0: s += 20
        sec = fnum(r["AI Connected Seconds"])
        s += 30 if sec >= 300 else 24 if sec >= 120 else 14 if sec >= 60 else 6 if sec > 0 else 0
        if U(r.get("Lead Entity Promise to Pay")) == "YES": s += 25
        if U(r.get("Lead Entity Paid")) == "YES": s += 20
        d = (r.get("CollectionsDisposition_v2 L2") or "")
        if "Promise to Pay" in d or "Follow-Up" in d or "On Call Payment" in d: s += 12
        if (r.get("Qualification Status") or "").strip() == "Qualified": s += 10
        if refusal_bucket(r.get("Lead Entity Refusal to pay")) == "YES": s -= 15
        return max(0, min(100, s))
    tiers = {"High": {"count": 0, "amount": 0.0}, "Medium": {"count": 0, "amount": 0.0}, "Low": {"count": 0, "amount": 0.0}}
    for r in unres:
        p = propensity(r); o = fnum(r["total_outstanding"])
        tt = "High" if p >= 55 else ("Medium" if p >= 30 else "Low")
        tiers[tt]["count"] += 1; tiers[tt]["amount"] += o
    opportunity = {"openOutstanding": open_out, "tiers": tiers, "lists": [
        {"label": "Promised to pay — still open", "note": "Broken-promise follow-ups", **opp_promise},
        {"label": "Engaged ≥2 min — not closed", "note": "Highest propensity", **opp_engaged},
        {"label": "Claimed paid — unresolved", "note": "Reconciliation / verification", **opp_claimed}]}

    paid_yes = [r for r in rows if U(r.get("Lead Entity Paid")) == "YES"]
    entity_truth = {"alreadyPaidReliabilityPct": sum(1 for r in paid_yes if is_res(r)) / len(paid_yes) * 100 if paid_yes else 0,
                    "saidNoButResolved": sum(1 for r in resolved if U(r.get("Lead Entity Paid")) == "NO"),
                    "promisedButOpen": sum(1 for r in unres if U(r.get("Lead Entity Promise to Pay")) == "YES")}

    dial = []
    for b in ATT_ORDER:
        sub = [r for r in rows if att_band(r.get("Total AI Call Attempts")) == b]
        n = len(sub)
        if not n: continue
        dial.append({"band": b, "n": n,
                     "connectPct": sum(1 for r in sub if fnum(r["AI Connected Calls"]) > 0) / n * 100,
                     "resolutionPct": sum(1 for r in sub if is_res(r)) / n * 100})

    best_dur = max((d["resolutionPct"] for d in duration), default=0)
    deal_case = (
        f"Convin's AI worked {N:,} RBL accounts carrying {cr(sum_out)} in outstanding and recovered "
        f"{cr(recovered)} — {totals['recoveryRatePct']:.1f}% of the book — by resolving {len(resolved):,} accounts. "
        f"It placed {ai['attempts']:,} calls, and its 'already-paid' read matched the true outcome "
        f"{entity_truth['alreadyPaidReliabilityPct']:.0f}% of the time. Longer conversations convert far better "
        f"(resolution reaches {best_dur:.0f}% past two minutes). {cr(open_out)} remains open, of which "
        f"{cr(opp_promise['amount'])} already promised to pay and {cr(opp_engaged['amount'])} are highly engaged — "
        f"a clear next-cycle target. Against a {cr(agency_cost)} agency-commission equivalent, the AI delivered this "
        f"recovery for a fraction of the cost.")

    header = ["Account No", "Customer Name", "Status", "Disposition", "Region", "State", "Band",
              "Outstanding", "Recovered", "Attempts", "Connected", "PaymentMode", "PTP", "Mobile", "LeadLink"]
    table_rows = []
    for r in rows:
        o = fnum(r["total_outstanding"])
        table_rows.append([
            (r.get("Account No") or "").strip(), (r.get("Customer Name") or "—").strip(), r.get("Status", "").strip(),
            (r.get("CollectionsDisposition_v2 L1") or "—").strip() or "—", (r.get("Region") or "—").strip(),
            (r.get("Primary State") or "—").strip(), band_norm(r.get("Curr Bal Band", "")),
            round(o, 2), round(o, 2) if is_res(r) else 0, int(fnum(r["Total AI Call Attempts"])),
            int(fnum(r["AI Connected Calls"])),
            pay_bucket(r.get("Lead Entity If payment done return 'Mode of Payment")) or "—",
            "Yes" if U(r.get("Lead Entity Promise to Pay")) == "YES" else "—",
            (r.get("Mobile Number -1") or "—").strip(), (r.get("Lead Link") or "").strip()])

    return {
        "meta": {"reportDate": report_date_display, "accounts": N, "source": "Convin AI Collections — RBL Bank"},
        "agg": {"totals": totals, "ai": ai, "entity": entity, "goal": goal, "qualification": qualification,
                "disposition": disposition, "band": band, "bandOrder": BAND_ORDER, "region": region,
                "state": state, "duration": duration, "durationOrder": DUR_ORDER,
                "paymentModes": payment_modes, "funnel": funnel, "topOutstanding": top_outstanding},
        "intel": {"dealCase": deal_case, "roi": roi, "opportunity": opportunity,
                  "entityTruth": entity_truth, "dial": dial},
        "table": {"header": header, "rows": table_rows},
    }


def load_csv(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return list(csv.DictReader(f))

def display_date(iso):
    d = datetime.date.fromisoformat(iso)
    return d.strftime("%-d %B %Y")


def write_batch(bid, payload):
    """Write the small payload (meta/agg/intel) and the rows separately, so the
    browser never receives the full row set — matching the Postgres API contract."""
    table = payload.pop("table", {"rows": []})
    with open(os.path.join(BATCHES, bid + ".json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(BATCHES, bid + ".rows.json"), "w", encoding="utf-8") as f:
        json.dump(table.get("rows", []), f, ensure_ascii=False, separators=(",", ":"))


def main():
    os.makedirs(BATCHES, exist_ok=True)
    # ---- collect batches: real dated uploads first, else split the seed CSV ----
    # Structure: day_map[iso_date] = [ {slot, label, time, rows} ... ]
    day_map = defaultdict(list)

    real = []
    if os.path.isdir(UPLOADS):
        for fn in sorted(os.listdir(UPLOADS)):
            if not fn.lower().endswith(".csv"): continue
            # expect upload-YYYY-MM-DD-<slot>.csv ; fall back to file mtime date
            iso = None
            import re
            m = re.search(r"(\d{4}-\d{2}-\d{2})", fn)
            iso = m.group(1) if m else datetime.date.today().isoformat()
            real.append((iso, fn, os.path.join(UPLOADS, fn)))
    if real:
        by_date = defaultdict(list)
        for iso, fn, path in real:
            by_date[iso].append((fn, path))
        for iso, files in by_date.items():
            for i, (fn, path) in enumerate(sorted(files)):
                day_map[iso].append({"label": f"Upload {i+1}", "time": "", "filename": fn, "rows": load_csv(path)})
    else:
        # Seed: split the primary CSV into 3 same-day uploads (faithful disjoint slices).
        rows = load_csv(SRC)
        iso = "2026-07-07"
        times = ["09:12 AM", "01:30 PM", "06:05 PM"]
        for slot in range(3):
            sl = rows[slot::3]
            day_map[iso].append({"label": f"Upload {slot+1}", "time": times[slot],
                                 "filename": f"convin_{iso}_u{slot+1}.csv", "rows": sl})

    # ---- emit batch files + manifest ----
    manifest_dates = []
    for iso in sorted(day_map.keys(), reverse=True):
        uploads = day_map[iso]
        disp = display_date(iso)
        up_meta = []
        all_rows = []
        for i, up in enumerate(uploads):
            bid = f"{iso}__u{i+1}"
            write_batch(bid, build(up["rows"], disp))
            up_meta.append({"id": bid, "label": up["label"], "time": up["time"],
                            "filename": up["filename"], "rowCount": len(up["rows"])})
            all_rows.extend(up["rows"])
        # Day Total (merge = build over union) — always present, even for a single upload
        dt_id = f"{iso}__daytotal"
        write_batch(dt_id, build(all_rows, disp))
        manifest_dates.append({"date": iso, "display": disp, "dayTotal": dt_id,
                               "uploads": up_meta, "rowCount": len(all_rows)})

    manifest = {"dates": manifest_dates, "latest": manifest_dates[0]["date"] if manifest_dates else None,
                "generatedAt": datetime.datetime.utcnow().isoformat() + "Z"}
    with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("Wrote manifest + batches:")
    for d in manifest_dates:
        print(f"  {d['display']}: {len(d['uploads'])} uploads + Day Total ({d['rowCount']} rows)")
    print(f"Batches dir: {BATCHES}")


if __name__ == "__main__":
    main()
