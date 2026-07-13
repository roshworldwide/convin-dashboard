import os
import pandas as pd
import json
from datetime import datetime

# Define paths
excel_path = 'src/data/12 PDD4 Convin 6th July RBL.xlsx'
output_json_path = 'src/data/data.json'

print(f"Reading Excel file from {excel_path}...")
df = pd.read_excel(excel_path, dtype=str)
df = df.fillna('')

# Convert numeric fields for math operations
def to_float(val):
    try:
        return float(val) if val != '' else 0.0
    except:
        return 0.0

def to_int(val):
    try:
        return int(float(val)) if val != '' else 0
    except:
        return 0

# Totals
total_accounts = len(df)
sum_out = sum(df['Total Outstanding'].apply(to_float))
sum_tad = sum(df['Total Amount Due'].apply(to_float))
sum_mad = sum(df['Minimum Amount Due'].apply(to_float))
sum_lpa = sum(df['Last Payment Amount'].apply(to_float))

# Multi-account count (accounts with total accounts with customer > 1)
multi_accts = sum(df['Total Accounts with customer'].apply(to_int) > 1)

totals = {
    "accounts": total_accounts,
    "sumOut": sum_out,
    "sumTad": sum_tad,
    "sumMad": sum_mad,
    "sumLpa": sum_lpa,
    "multiAcct": int(multi_accts)
}

# Segment count
segment_counts = df['Segment'].value_counts().to_dict()
segment = {
    "Orange": segment_counts.get("Orange", 0),
    "Green": segment_counts.get("Green", 0),
    "Red": segment_counts.get("Red", 0)
}

# Band stats: Curr Bal Band -> {sum, count}
band_order = ['20-30K','30-50k','50-70k','70-100K','100-200k','>200k']
band = {}
for b in band_order:
    sub_df = df[df['Curr Bal Band'] == b]
    band[b] = {
        "sum": float(sub_df['Total Outstanding'].apply(to_float).sum()),
        "count": int(len(sub_df))
    }

# Region counts
region_counts = df['Region'].value_counts().to_dict()
region = {
    "East": region_counts.get("East", 0),
    "North": region_counts.get("North", 0),
    "West": region_counts.get("West", 0)
}

# Region outstanding sums
region_out = {}
for r in ['East', 'North', 'West']:
    sub_df = df[df['Region'] == r]
    region_out[r] = {
        "sum": float(sub_df['Total Outstanding'].apply(to_float).sum()),
        "count": int(len(sub_df))
    }

# Decile stats: Decile -> {sum, count}
decile_order = [str(x) for x in range(2, 11)]
decile = {}
for d in decile_order:
    sub_df = df[df['Decile'] == d]
    decile[d] = {
        "sum": float(sub_df['Total Outstanding'].apply(to_float).sum()),
        "count": int(len(sub_df))
    }

# Strategy counts
strategy_order = ['Others','High Bal','STPL','Model 2']
strategy_counts = df['As Per New Logic'].value_counts().to_dict()
strategy = {s: strategy_counts.get(s, 0) for s in strategy_order if s in strategy_counts or s != 'Model 2'}

# Strategy M2 counts
strategy_m2_counts = df['As Per New Logic M2'].value_counts().to_dict()
strategy_m2 = {s: strategy_m2_counts.get(s, 0) for s in strategy_order}

# Title counts
title = df['Title'].value_counts().to_dict()

# Gender counts
gender_counts = df['GENDER'].value_counts().to_dict()
gender = {
    "Male": gender_counts.get("Male", 0),
    "Female": gender_counts.get("Female", 0),
    "Unknown": gender_counts.get("Unknown", 0)
}

# State aggregations: Primary State -> {sum, count}
state_agg = {}
for s in df['Primary State'].unique():
    sub_df = df[df['Primary State'] == s]
    state_agg[s] = {
        "sum": float(sub_df['Total Outstanding'].apply(to_float).sum()),
        "count": int(len(sub_df))
    }

# City aggregations: pm_city -> {sum, count}
city_agg = {}
for c in df['pm_city'].unique():
    sub_df = df[df['pm_city'] == c]
    city_agg[c] = {
        "sum": float(sub_df['Total Outstanding'].apply(to_float).sum()),
        "count": int(len(sub_df))
    }

# Recency calculation relative to 2026-07-02
ref_date = datetime(2026, 7, 2)
recency_buckets = {'0-7d': 0, '8-14d': 0, '15-30d': 0, '31-60d': 0, '60d+': 0, 'Never': 0}

for lpd in df['Last Payment Date']:
    val = str(lpd).strip()
    if not val or val == 'Never' or val == '0':
        recency_buckets['Never'] += 1
        continue
    try:
        p_date = datetime.strptime(val, '%d-%m-%Y')
        diff = (ref_date - p_date).days
        if diff < 0:
            diff = 0
        if diff <= 7:
            recency_buckets['0-7d'] += 1
        elif diff <= 14:
            recency_buckets['8-14d'] += 1
        elif diff <= 30:
            recency_buckets['15-30d'] += 1
        elif diff <= 60:
            recency_buckets['31-60d'] += 1
        else:
            recency_buckets['60d+'] += 1
    except:
        recency_buckets['Never'] += 1

# MOB buckets counts
mob_buckets = {'0-12': 0, '13-24': 0, '25-36': 0, '37-48': 0, '49-60': 0, '61-120': 0, '120+': 0}
for mob_val in df['Months on Book']:
    mob = to_int(mob_val)
    if mob <= 12:
        mob_buckets['0-12'] += 1
    elif mob <= 24:
        mob_buckets['13-24'] += 1
    elif mob <= 36:
        mob_buckets['25-36'] += 1
    elif mob <= 48:
        mob_buckets['37-48'] += 1
    elif mob <= 60:
        mob_buckets['49-60'] += 1
    elif mob <= 120:
        mob_buckets['61-120'] += 1
    else:
        mob_buckets['120+'] += 1

# Segment Region cross counts
seg_region_cross = {}
for r in ['East', 'North', 'West']:
    seg_region_cross[r] = {}
    for s in ['Green', 'Orange', 'Red']:
        count = len(df[(df['Region'] == r) & (df['Segment'] == s)])
        seg_region_cross[r][s] = int(count)

# Consolidate AGG
AGG = {
    "totals": totals,
    "segment": segment,
    "band": band,
    "region": region,
    "regionOut": region_out,
    "decile": decile,
    "strategy": strategy,
    "strategyM2": strategy_m2,
    "title": title,
    "gender": gender,
    "stateAgg": state_agg,
    "cityAgg": city_agg,
    "recency": recency_buckets,
    "mobBuckets": mob_buckets,
    "segRegionCross": seg_region_cross
}

# Table mapping
table_header = [
    "Account No", "Total Outstanding", "Total Accounts with customer", "Total Amount Due", "Minimum Amount Due",
    "Last Payment Date", "Last Payment Amount", "Delinquency History", "Months on Book", "Card Number (Last 4 digits)",
    "Curr Bal Band", "Segment", "Title", "Customer Name", "Primary State", "Mobile Number -1", "Decile",
    "Region", "As Per New Logic", "As Per New Logic M2", "pm_city", "pm_state", "AltNumbers"
]

rows = []
for idx, r in df.iterrows():
    # Build AltNumbers from alternate_no1 to alternate_no10
    alt_numbers = []
    for i in range(1, 11):
        col_name = f"alternate_no{i}"
        val = str(r[col_name]).strip()
        if val and val != '0' and val != '0.0' and val != 'Never':
            # Clean float decimal if any
            if val.endswith('.0'):
                val = val[:-2]
            alt_numbers.append(val)
    alt_str = ";".join(alt_numbers)

    row_vals = [
        str(r["Account No"]).strip(),
        str(r["Total Outstanding"]).strip(),
        str(r["Total Accounts with customer"]).strip(),
        str(r["Total Amount Due"]).strip(),
        str(r["Minimum Amount Due"]).strip(),
        str(r["Last Payment Date"]).strip(),
        str(r["Last Payment Amount"]).strip(),
        str(r["Delinquency History"]).strip(),
        str(r["Months on Book"]).strip(),
        str(r["Card Number (Last 4 digits)"]).strip(),
        str(r["Curr Bal Band"]).strip(),
        str(r["Segment"]).strip(),
        str(r["Title"]).strip(),
        str(r["Customer Name"]).strip(),
        str(r["Primary State"]).strip(),
        str(r["Mobile Number -1"]).strip(),
        str(r["Decile"]).strip(),
        str(r["Region"]).strip(),
        str(r["As Per New Logic"]).strip(),
        str(r["As Per New Logic M2"]).strip(),
        str(r["pm_city"]).strip(),
        str(r["pm_state"]).strip(),
        alt_str
    ]
    rows.append(row_vals)

TABLE = {
    "header": table_header,
    "rows": rows
}

# Final Output
data_out = {
    "AGG": AGG,
    "TABLE": TABLE
}

os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
with open(output_json_path, 'w', encoding='utf-8') as f:
    json.dump(data_out, f, ensure_ascii=False)

print(f"Data generation complete. File written to {output_json_path}")
print(f"Total rows processed: {len(rows)}")
