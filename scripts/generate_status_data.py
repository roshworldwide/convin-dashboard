import pandas as pd
import json
import os

excel_path = 'src/data/7 July Status File.xlsx'
output_json_path = 'src/data/status_data.json'

print(f"Reading Excel status file from {excel_path}...")
df = pd.read_excel(excel_path, dtype=str)
df = df.fillna('')

print("Processing rows...")
# Extract account_no and status as a list of lists for extreme compactness
rows = []
for idx, r in df.iterrows():
    acct = str(r['account_no']).strip()
    status = str(r['status']).strip()
    # Handle any leading zeros if float representation has been loaded
    if acct.endswith('.0'):
        acct = acct[:-2]
    # Ensure it's padded if it was a shorter integer string representation (e.g. 19 digits or 16 digits)
    # The original RBL account numbers are generally 19 or 16 digits long.
    # Standard check: RBL accounts from main file were 19 digits.
    # In df head output, we saw '7478800066109993' which is 16 digits. Let's keep it as is.
    rows.append([acct, status])

os.makedirs(os.path.dirname(output_json_path), exist_ok=True)

print(f"Saving compiled data to {output_json_path}...")
with open(output_json_path, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False)

print(f"Data generation complete. Total rows: {len(rows)}")
