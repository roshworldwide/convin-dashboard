# RoshRegression — Convin leadership meeting

**Talk track + objection bank.** 18 minutes of content, 25 minutes of questions.
Read this once the night before. Do not read it in the room.

---

## Before you walk in

**Three rules.**

**Rule one: do not demo the dashboard first.** The dashboard is the least defensible thing you built — it's pretty, and pretty is cheap. Every vendor has a dashboard. Open with the finding. Earn the right to show the UI.

**Rule two: never claim a number you cannot reproduce in the room.** You have the account table. Anything you say, you should be able to filter and prove within thirty seconds. If you can't, don't say it.

**Rule three: say the weakness before they find it.** You will be tempted to skip slide 10. Slide 10 is why they will believe slide 6.

**Have open on a second screen:** the dashboard on the real report (2026-07-08), filtered account table ready, and `npm run eval:sweep` output in a terminal. If someone challenges a number, you run it live.

---

## The script

### Slide 1 — Title (30 seconds)

> "I want to show you something we found in RBL's data. Not a feature. A finding. It has a name, it has been independently graded, and I think it is the reason we keep the account."

Then stop. Let the name sit on the screen.

Do **not** say "so basically what I did was..." Do not apologise for the name. It is a product now.

---

### Slide 2 — The problem (90 seconds)

> "RBL can replace our dialler in a quarter. On calls placed and minutes talked, we are interchangeable with four other vendors — which means the only thing left to negotiate is price. That is the meeting we are heading into unless something changes."

Point at the third row.

> "This is what changed. We now have something they cannot get by switching vendors: a model that tells their floor which accounts to work first."

**Stage direction:** the COO already knows you are commoditised. Naming it buys you credibility for the next nine slides. Do not soften it.

---

### Slide 3 — The finding (3 minutes — this is the whole meeting)

Let the chart load. Say nothing for two seconds.

> "Every collections floor in this country works the same way. You call the customers who promised to pay, because a promise is a good sign. RBL's agency does it. Our agents log it as a positive disposition."

Point at the red bar.

> "In one thousand nine hundred and eight real RBL accounts, the customers who promised to pay were the **least likely** to pay. Twenty-six percent, against a book average of forty-four. Eighteen points *below* average. A promise is a worse signal than silence."

**Pause. Count to three. Do not fill it.**

> "And this is the part that matters: any analyst at RBL can verify it in their own account table in thirty seconds. We are not asking them to trust us. We are handing them a fact about their own business that their current process is actively getting wrong."

**If someone says "that can't be right":** good. That is the correct reaction, and it is why the slide works.

> "It surprised me too. So I checked it three ways — in the raw CSV in Python, in the model, and in an independent eval framework. It holds. The intuition is simple once you see it: a promise is what a customer gives you to end the call."

---

### Slide 4 — What it is (90 seconds)

> "RoshRegression is a regularised logistic regression. Fourteen inputs. It refits from scratch on every report RBL uploads, so it learns *their* book, not a generic one."

Go down the four cards fast. Land hard on the second one.

> "Nothing leaves their building. No API key, no external model, no call to anyone's cloud. Their cardholders' financial data is scored inside their own environment and stays there. For a bank, that is not a nice-to-have. That is the difference between a six-week security review and an eighteen-month one."

Then, pre-empting the question everyone is already forming:

> "It is not an LLM. I know what you are thinking, and I ran the experiment."

---

### Slide 5 — vs the LLM (2 minutes)

> "Same hundred and twenty held-out accounts. Same question. A frontier model against RoshRegression."

> "It tied. Zero-point-seven-five against zero-point-seven-four-two. p equals one — statistically indistinguishable. RoshRegression did not beat the LLM."

**Say that sentence plainly. Do not spin it.** Then:

> "And a tie is the strongest result we could have got. Because the LLM needed an API call per account, a network round-trip, and every RBL cardholder's financial data leaving the bank — to draw *level* with sixty lines of maths running on their own hardware for free."

> "Send that sentence to RBL's CISO and the LLM loses on the spot."

**One more thing, and say it:** > "I should add — the LLM was given an unfair advantage in that test. It knew things about the book a cold model wouldn't. It still only tied."

---

### Slide 6 — Ten reports, ten wins (2 minutes)

> "One good day proves nothing. So we ran it ten times, on ten different books — different sizes, different connect rates, different balance mixes. Every time: fit on eighty percent, scored on the twenty percent it had never seen."

> "Ten out of ten. It beat the incumbent playbook on every single report. The weakest result still carried a p-value of one-point-seven times ten to the minus nine."

Point at the gap between the two lines.

> "And look at the shape. The lines never touch."

Then — **and do not skip this** — read the footnote:

> "One thing I need to be straight about. Nine of these ten reports are synthetic — bootstrap resamples of the real book. Every row is a real account with a real outcome, so the *stability* claim is sound. But the rupee figures on those days are not real, and nobody in this room should ever quote them to RBL as recoveries. If we do that and they catch it, we lose the account and we deserve to."

**This paragraph is the most valuable thirty seconds in the meeting.** It tells the COO you can be trusted in front of a client unsupervised.

---

### Slide 7 — Drift (60 seconds)

> "A collections model that only works on good dialling days is worthless. The bad days are exactly when RBL needs to know who to call. So we broke the book on purpose."

> "Day six — half the accounts never picked up the phone. The model scored seventy-four-point-one, which is *above* its own average, and it beat the incumbent by twenty-three points. The edge barely moves when conditions collapse."

> "That is the difference between a demo and a system."

---

### Slide 8 — Worth to RBL (90 seconds)

**This is the slide for RBL's collections head, not their risk team. Change register.**

> "Forget accuracy for a second. Here is the operational number."

> "Work the top ten percent of accounts by score, and you capture twenty-two-and-a-half percent of every rupee that was going to come in. That is two-and-a-quarter times what you get working the book at random."

> "Same agents. Same dialler. Same day. Different call order. That's it."

> "And the ask is small: let us rank the eight-point-six-nine crore they have already half-written-off."

---

### Slide 9 — The strategy (90 seconds)

**Slow down. This is the slide the COO is actually in the room for.**

> "A dialler gets procured. A decision layer gets embedded. That difference decides whether RBL is an annual negotiation or an annuity."

Walk the four steps. Land on four.

> "Once their floor is working our call order every morning, replacing Convin doesn't mean swapping a vendor. It means rebuilding how their recovery team decides who to call. That is no longer a procurement decision."

---

### Slide 10 — What we are not claiming (90 seconds)

> "Four things I want you to hear from me rather than from RBL."

Go through them without flinching. Then:

> "A bank does not buy the vendor with the best numbers. It buys the one it believes. Everything on slide six is only worth something because of slide ten."

---

### Slide 11 — The ask (60 seconds)

> "Three decisions."

State them. Then close and **stop talking**:

> "RBL is not buying a voice agent from us. They are buying the answer to 'who do we call first?' — and for the first time, we are the only ones who have it."

Do not add a thank-you slide. Do not trail off. Let it sit.

---

# THE OBJECTION BANK

## The landmine — expect this, prepare for it

### "Wait. If promise-to-pay is worthless, doesn't that mean our AI agents are bad at getting real promises?"

**This is the sharpest question in the room and it will probably come from the COO.** It reframes your best finding as an indictment of the core product. Do not get defensive.

> "I thought about that hard, and no — and here's why. Look at the 'talked two minutes' bar: plus seventeen-and-a-half points. Our agents *are* producing recovery, and they're producing it through conversation. What the data says is that the promise itself is a *bad label* — it's what a customer says to end a call, whether they mean it or not. Every human agency on earth records the same worthless promise. The difference is we're the only ones who measured it."

> "If anything this is an argument to change what our agents optimise for. Right now we log a promise as a win. We should be logging conversation depth."

**That last line turns the attack into a product roadmap. Have it ready.**

---

## On the model itself

### "It's a logistic regression. We're an AI company. This isn't AI."

> "It's a model trained on data that makes predictions no human made. Whether we call it AI is a marketing question, not a technical one — and for a bank, the boring word is the *feature*. Their model risk committee has approved logistic regressions for thirty years. They have approved zero LLMs. We can be in production this quarter or in review until next year."

> "Also worth saying: it tied a frontier LLM. If a fancier model beat it, I'd have shipped the fancier model."

### "Only 0.75 accuracy? It's wrong a quarter of the time."

> "Accuracy is the wrong metric and I'd push back on anyone at RBL who leads with it. We don't need a yes/no verdict on each account — we need a *call order*. On ranking, the top decile returns two-and-a-quarter times random. That's the number that changes their day."

> "For context: 0.75 AUC in credit risk is a deployable model. Anything claiming 0.95 on collections data is leaking the answer into the inputs, and I'd want to see their features."

### "It only catches 42% of the people who pay. That's terrible."

> "At a fifty-percent cut-off, yes — it's precise but timid. Which is exactly why we don't ship it as a label. We ship it as a ranked list. The threshold is an artefact of how I benchmarked it, not how RBL would use it."

**Don't defend the recall. Concede it, and redirect to ranking. It's the honest answer and the stronger one.**

### "Can a competitor build this in a week?"

> "The regression, yes — it's sixty lines. The *finding*, no, because it required somebody to look. And the thing they genuinely can't copy is the position: once RBL's floor is working our ranked list every morning, a competitor isn't selling a better dialler, they're asking RBL to rip out their operating rhythm."

> "The moat isn't the maths. It's being the model that's already inside."

### "Why is it named after you?"

Answer briefly and move on — do not get precious.

> "It needed a name so it could be a product rather than a feature. Happy to rename it to anything Convin wants — the name should be an asset for the company, not for me."

**Say this genuinely. Fighting for the name in this meeting costs you the room and gains you nothing.**

---

## On the evidence

### "You tested on synthetic data. So the results are fake."

> "Nine of ten reports are resampled — but every *row* is a real account with a real outcome. Nothing about the relationship between the calls and the payments was invented. What varies is the mix: book size, connect rate, balance skew. That's what stress-tests stability, and stability is the only thing I'm claiming from those ten."

> "The finding, the AUC, and the head-to-head against the LLM are all from the real book. And point three of the ask is: fund one live cycle, and this objection disappears permanently."

### "Why should RBL believe a vendor's own numbers?"

> "They shouldn't, and that's the design. Every claim in the dashboard is reproducible by them: filter the account table by any signal and the rate they see is the rate we measured. And the validation didn't come from us — it came from an open-source eval framework using paired significance tests. They can run it themselves."

### "Is the ₹6.50 Cr real?"

> "Yes — that's the real book, 1,908 accounts, using the rule RBL themselves specified: status Resolved means the full outstanding is recovered. If they want to define recovery differently, the number changes and I'll rerun it in an hour. I'd rather have that argument than hide the assumption."

### "What if RBL's risk team rejects the model?"

> "Then we've lost nothing, because the *finding* survives the model. Promise-to-pay being negative is a fact about their book, not an output of RoshRegression. Even if they never deploy a line of our code, that insight alone reframes who we are to them."

**This is your fallback position and it is a strong one. Have it in your pocket.**

---

## On the risk

### "If we tell them to talk longer, will recovery go up?"

**Trap question. Do not say yes.**

> "I don't know, and I won't claim it. What the data shows is that long conversations *identify* people who will pay — willing payers are also willing talkers. It does not prove that forcing longer calls creates payment. If we tell RBL to make their agents talk longer and recovery doesn't move, we've burned the credibility of everything else."

> "The honest version is: it's a targeting signal, not a lever. And if they want to know whether it's a lever, that's an A/B test — which is another thing we could run for them."

### "What if the model says don't call someone, and they would have paid?"

> "It doesn't say don't call. It says call them *later*. It's a ranking, not a kill list — nobody gets dropped, the order changes. I'd make sure that's explicit in how we position it, because 'the AI told us not to chase you' is a headline nobody wants."

### "Does this expose customer data?"

> "The opposite. It's the only version of this that *doesn't*. No API key, no external model, no data leaving their environment. That's a slide I'd put in front of their CISO deliberately, not defensively."

---

## On commercials

### "What did this cost us to build?"

Answer with the truth and pivot to leverage:

> "It's a few hundred lines of code inside the ingest pipeline we already had. The marginal cost of running it is effectively zero — about four milliseconds a batch. It doesn't add a rupee to our cost of serving RBL."

### "How much more do we charge for it?"

> "I'd argue we don't charge separately for it at all — not in year one. It's the reason they renew, not a line item. Once their floor depends on the ranking, the pricing conversation happens from a completely different position."

**Only say this if you believe it. If the COO wants a line item, don't fight — offer to model both.**

---

## Questions where you must say "I don't know"

Say it cleanly. It buys more credibility than a guess.

- **"What will it do on a book ten times this size?"** → "I don't know. It's designed for it and the architecture handles a million rows a day, but I have not tested it at that scale on real data. I'd want one cycle before I promised RBL anything."
- **"Will it work for auto loans / personal loans?"** → "No idea. Different book, different signals. It would need refitting and revalidating, and I wouldn't sell it until it was."
- **"What's the lift in rupees, not percent?"** → "I can't give you a defensible rupee number until we run a live cycle, because that depends on how many accounts their floor can actually work in a day. I'd rather give you the ranking multiple than a rupee figure I can't stand behind."

---

## The one-line summary, if you get thirty seconds in a lift

> "We found that RBL's collections team has been chasing the wrong customers — the ones who promise to pay are the least likely to pay — and we built the model that tells them who to call instead. It beat their current playbook on ten out of ten reports and tied a frontier LLM while running entirely inside their own bank."
