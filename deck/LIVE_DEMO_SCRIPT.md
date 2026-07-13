# RoshRegression — live demo script

**No slides. You drive the product.** ~14 minutes of demo, the rest is questions.

A deck lets you control the sequence. A live demo doesn't — they will interrupt, and
they will want to click. That's good: it's the whole point. But it means you rehearse
the *path*, not the words.

---

## Before you open the laptop

**Reset to a clean state.** Run this the morning of, not five minutes before:

```bash
npm run demo:real     # wipes every test report, seeds ONE day from the real book
npm run dev
```

You should see exactly one report day, one upload, 1,908 accounts, ₹6.50 Cr.

**Why this matters:** *Day Total sums every upload for a date.* During development there
were days with the same book uploaded twice — and Day Total cheerfully doubled the
recovery figure. If that happens on screen, you will not recover from it. One day.
One upload.

**Set up:**

- Browser at 100% zoom, one window, no other tabs. Bookmarks bar hidden.
- Dark mode or light — pick one now, don't toggle live, it's a distraction.
- Have these on the desktop, ready to drag:
    - `3_SPLIT_portfolio_sheet.csv`  -> goes in slot **1 · CYC / PDD**
    - `2_SPLIT_status_sheet.csv`     -> goes in slot **3 · Lead Outcome**
    - `1_MERGED_full_sheet.csv`      -> the fallback, for slot **Already merged**
  (The upload page has three slots now. Leave slot 2 · Status empty — these two
  sheets already carry the outcome between them, and leaving it empty is what
  triggers the refusal you want.)
- A terminal open behind the browser with `npm run eval:sweep` ready to run. You
  probably won't need it. If someone challenges the model, you run it in front of them.
- Wi-Fi off. Genuinely. **Nothing in this app needs the internet, and proving that
  by accident is the single most powerful thing that can happen in the room.**

**The one rule.** Do not narrate the UI. Nobody cares that it's fast or that the
animations are nice. Every sentence you say should be about *their money* or *their
decisions*. If you catch yourself saying "and here you can see...", stop.

---

## The demo

### 0. The login screen — 15 seconds

Don't skip it and don't linger. They'll read it before you speak. Let them.

> "Log in."

Type. Enter. That's it. The screen does its own work.

---

### 1. The upload — 2 minutes. **It is supposed to fail. That is the point.**

**Start at the hub, not the dashboard.** They need to see the file go in.

Click **Upload a new CSV**. Drag **3_SPLIT_portfolio_sheet.csv** into slot **1 · CYC / PDD**,
and **2_SPLIT_status_sheet.csv** into slot **3 · Lead Outcome**.

> "Three files. The CYC file — the book you handed us. The status file — who actually
> paid, which comes from you, not from us. And our campaign export — who we called and
> what they said. Today somebody VLOOKUPs these together in Excel. So I built it in."

> "Watch."

Hit upload. **It refuses.** A red error appears:

> *"This upload would report the wrong number, so it has been stopped. 190 of 1,908 rows
> have no status (e.g. account 7.4787E+15). Those accounts would be counted as ₹0 and the
> recovery figure would be understated."*

**Do not apologise. Do not touch the keyboard. Turn and look at them.**

> "It won't run. And that is the most valuable thing on this screen."

> "One hundred and ninety of your rows — thirty-nine distinct accounts — have account
> numbers that Excel has silently destroyed. 7.4787E+15. That's not a bug in our
> software; that's what Excel does to a nineteen-digit number when nobody formats the
> column as text."

> "If I joined on those, I would attach one customer's balance to a different customer.
> So it refuses to guess, and it refuses to load, because a collections dashboard that
> understates your recovery is worse than one that won't open."

**Then the line that lands:**

> "Somebody on your floor is doing this join in Excel this week. Which means right now,
> those accounts are either being silently dropped from your numbers — or worse,
> attached to the wrong customer. Nobody has told you, because Excel doesn't warn you."

**Stop. Let it sit.**

You have just found a live data-integrity problem in a bank's own reporting, in the
first two minutes, without being asked, using their own file. **Nothing else you do
today will buy you more credibility than this.** If the laptop dies right after, the
meeting was still worth having.

Then, calmly:

> "So let's use the export that already has both halves in it."

Drag in **1_MERGED_full_sheet.csv** on its own, mode = **already merged**. It loads.
₹6.50 Cr. The corruption warning still shows at the top of the dashboard — point at it
once and move on.

---

**If you'd rather not risk a live refusal in front of the COO:** upload only the merged
sheet, and *say* the paragraph above while pointing at the amber data-quality banner,
which reports the same 190 rows. Weaker, but safe. I'd take the risk — a product that
refuses to lie is the whole pitch.

---

### 2. The headline — 45 seconds

The dashboard loads.

> "Six crore fifty lakh recovered. Nineteen hundred accounts, forty-three point eight
> percent of them resolved."

Don't walk the KPI cards. Don't read them out. They can read.

Scroll straight past them to **Executive Intelligence**.

> "That paragraph writes itself from the data every time you upload. Nobody types it."

Point at **Agency-commission equivalent — ₹77.95 L**.

> "That's what a recovery agency would have billed you in commission for this same
> result. Twelve percent. It's the only number on this page we didn't measure — it's
> your commercial rate, and it's tagged as an assumption. Change it and everything
> downstream changes."

**Deliberately flag your own assumption before they find it.** It buys you every other
number on the page.

---

### 3. The finding — 4 minutes. This is the meeting.

Scroll to **RoshRegression**.

Say nothing for two seconds. Let them read the name and the 0.744.

> "Every collections floor in this country works the same way. You call the customers
> who promised to pay, because a promise is a good sign. Your agency does it. Our own
> AI logs it as a positive outcome."

Point at the red bar.

> "In your nineteen hundred accounts, the customers who promised to pay were the
> **least likely** to pay. Twenty-six percent, against a book average of forty-four.
> Eighteen points below average."

> "A promise is a worse signal than silence."

**Stop. Count to three. Do not fill the silence.**

Someone will say some version of *"that can't be right."* Good. That is the correct
reaction and it is why the finding is worth anything.

> "It surprised me too. So let's not take my word for it."

---

### 4. THE PROOF — 90 seconds. Do not skip this.

Scroll to the **Account Explorer**. Set the **PTP** filter to **Yes**.

> "Two hundred and twenty-seven accounts promised to pay."

Now set **Status = Resolved**.

> "Fifty-eight of them actually did. That's twenty-five point six percent."

Clear the filters.

> "Book average, forty-three point eight."

> "I'm not asking you to trust the model. I'm asking you to trust your own table. Any
> analyst in this room can reproduce that in twenty seconds."

**This is the moment the room turns.** A vendor showing you a number is marketing. A
vendor handing you the tool to check the number is something else. Slow down here.

---

### 5. What it's worth — 2 minutes

Scroll back up to **Recoverable Opportunity**.

> "Eight crore sixty-nine lakh still open. RoshRegression has ranked every one of those
> accounts by how likely it is to actually pay."

Point at the tiers.

> "High propensity: one crore twenty-nine lakh across a hundred and forty accounts.
> That's where your floor should be tomorrow morning."

> "And here's the operational number — forget accuracy. **Work the top ten percent of
> the book by this ranking and you capture twenty-two and a half percent of every rupee
> that was going to come in. That's two and a quarter times working it at random.**"

> "Same agents. Same dialler. Same day. Different call order."

---

### 6. Open the model — 2 minutes (only if there's a technical person in the room)

Click **Inspect the model**.

> "Fourteen inputs. Fourteen readable coefficients. It's a regularised logistic
> regression — the same maths your credit risk team has been signing off on for thirty
> years. Not a neural network, not an LLM, and that's deliberate."

> "It refits from scratch on every report you upload, so it learns *your* book. And
> nothing leaves your building — no API key, no external model, no call to anyone's
> cloud."

**If your Wi-Fi is off, say so now.** It lands harder than any slide could.

> "My laptop isn't on the internet right now."

Then read the honesty panel out loud — the one that says it's correlation, not cause.

> "It identifies the customers who will pay. It does not prove that forcing longer calls
> creates payment. Willing payers are also willing talkers. If we told you to make your
> agents talk longer and recovery didn't move, you'd never believe another number we
> showed you."

---

### 6b. Hand them the paper — 15 seconds

Before you close, hit **Print** in the island.

> "And you can take this with you."

The PDF is the dashboard, exactly as they just watched it, with the model's method and
its stated weaknesses expanded into it. Nobody has to remember your numbers.

---

### 7. Close — 30 seconds

Stop scrolling. Turn away from the screen. Look at them.

> "You're not buying a voice agent from us. You're buying the answer to *who do we call
> first* — and right now, we're the only ones who have it."

Don't add anything. Don't go back to the dashboard.

---

# WHEN THEY INTERRUPT

They will. Answer *in the product*, not in words — that's the advantage a demo has.

| They ask | Where you go | What you say |
|---|---|---|
| "Is this real data?" | Account Explorer | "Your export. Nineteen hundred and eight accounts. Search any account number." |
| "How do I know the model isn't hardcoded?" | — | "Upload a different book. Its findings change — I'll show you a book where promise-to-pay is *positive* and it flips." |
| "What if the CSV is wrong?" | Re-upload with a bad sheet | "It refuses to load. It'd rather show you nothing than a number that's understated." |
| "Show me the biggest accounts" | Sort by Outstanding | Let them drive for a minute. It's fine. |
| "What's the AUC mean?" | Inspect the model | "Coin flip is 0.5. Credit risk calls 0.7 deployable. We're at 0.744, measured on accounts it never saw." |
| "Why not an LLM?" | — | "We tested it. It tied — and the LLM needed every cardholder's data to leave the bank to draw level. Send that to your CISO." |
| "Can it handle our volume?" | Upload the 10k file | Ten thousand accounts, under half a second. |

---

# THE TWO QUESTIONS THAT CAN HURT YOU

### "If promises are worthless, doesn't that mean your AI is bad at getting real ones?"

The sharpest question in the room, and it turns your best finding into an attack on the
core product. Don't get defensive.

> "I thought about that hard, and no. Look at the two-minute bar — plus seventeen
> points. The agents *are* producing recovery, and they're producing it through
> conversation. What the data says is that the promise is a bad **label** — it's what a
> customer says to end a call, whether they mean it or not. Every human agency on earth
> records the same worthless promise. The difference is we're the only ones who measured
> it."

> "If anything it's an argument to change what our agents optimise for. Right now we log
> a promise as a win. We should be logging conversation depth."

That last line turns the attack into a roadmap. Have it ready.

### "Where does this run?"

Do not improvise. Do not say Vercel.

> "Today, on this laptop, offline. For production it goes inside Convin's existing
> RBL-approved environment — the same infrastructure that already processes your call
> data under our current contract. It's a Postgres app; it drops in. No new
> sub-processor, no new country, nothing that isn't already in the agreement."

---

# IF IT BREAKS

**It won't crash — but if it does:** don't debug in front of them. Close the laptop.

> "Let me not waste your time fighting a laptop. Here's the finding, and here's how you
> check it yourselves."

Then say the promise-to-pay number from memory: **227 accounts promised, 58 paid, 25.6%
against a 43.8% book average.** The finding survives without the software. That's the
whole reason it's the finding and not the software that matters.

**Have the deck as a silent backup** (`RoshRegression_Convin_Briefing.pptx`). Don't
open it unless the laptop is genuinely dead.
