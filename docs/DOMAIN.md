# Domain Model — Daily Sales & Inventory Report (DSIR)

How the bakery actually operates, and what the system has to preserve.
Derived from the working spreadsheet and from the owner's description of the process.

> Read this before designing anything that touches stock, sales or prices.
> Several rules here look like quirks but are deliberate controls.

---

## The business

Ten branches trading under three names (split 7 / 2 / 1). Family business, one
manager over all of them.

The names are branding only. **All ten share one product catalogue and one price
list.** They are modelled as plain branches; there is deliberately no "brand" or
"company" entity, because nothing in the business differs along that axis.

Catalogue: ~149 products in five sections — CAKES, SPECIAL, BREADS, BEVERAGES,
Ice Cream. Cakes are stocked like everything else, not made to order, so **the
DSIR captures all revenue**. There is no separate order book.

---

## The DSIR

One sheet per branch per day. It is not a sales log — it is a **stock
reconciliation** from which sales are inferred.

### The daily cycle

| When | Who | What |
|------|-----|------|
| Open | **Opener** | Physically recounts the shelf → `BEG. BAL` |
| Day | staff | Production arrives; stock leaves by one of four routes |
| Close | **Closer** | Physically counts the shelf → `ENDG. BAL` |

Two different people author one sheet at two different moments. That matters:
every count is attributable to a named person, and the system should keep that.

`BEG. BAL` should equal yesterday's `ENDG. BAL`. When the opener's recount
disagrees, they write what they actually counted — and **the disagreement is
currently discarded**. It is real signal (overnight loss, or a miscount by one of
two known people) and should be recorded rather than overwritten.

### The four ways stock leaves

| Route | Cash today | Who absorbs it | Notes |
|-------|-----------|----------------|-------|
| **Sold** | into the drawer | — | never recorded directly; derived |
| **Charged** | none — recovered via payroll | **the employee** | full selling price |
| **Pulled out** | none, ever | **the business** | the only true loss |
| **Transferred** | none | nobody | moves between branches; routine, see below |

**Charges** are employee mistakes — dropped or burned product. The employee pays
**full selling price**, deducted from salary, and may take the item home (but not
eat it on shift; that rule exists to stop deliberate "accidents"). Economically a
charge is a *deferred sale*, not a loss. It is subtracted from derived sales
because no cash entered the drawer today.

**Pull-outs** are discarded stock. This is the only genuine loss, and its peso
value is a number worth watching per branch and per product.

### Transfers are a routine distribution flow, not an exception

Some products are made **centrally** and distributed: one branch bakes the cakes
for everyone, another makes the cream bread. Not every product, but for those
that are centralised this happens daily.

> The three sample sheets showed **zero** transfers, which led to an early wrong
> conclusion that transfers were rare. Those sheets are all from a *receiving*
> branch — it has nothing to send, so its transfer columns are empty. A sending
> branch's sheet looks completely different. Beware generalising from one branch.

**On paper there is no transfers-IN column.** The formula has only one additive
slot (`OVER END`), so a receiving branch currently books arrivals under
**`PROD'c`**. That balances the arithmetic but has costs: the branch's production
figures claim output it never made, nothing records where the stock came from,
and it blunts the quota-versus-actual check on production.

**In the system, a transfer is recorded once by the SENDING branch** and appears
automatically as inbound on the receiving branch's report for the same date. One
record, two views, so the branches cannot disagree about it.

Inbound is read **live**, not stored, which makes encoding order irrelevant —
forms arrive in batches and either branch may be encoded first. A receiving
report entered before its sender simply shows the stock once the sender is
encoded, with nothing to re-enter. Until then the line reads negative and is
flagged as impossible, which is the correct signal: something is missing.

### The derivation

```
PRE TOTAL = BEG.BAL + PROD'c + (transfers in) − (transfers out) + OVER END
DIFF      = PRE TOTAL − Charges − PULLED OUT − ENDG.BAL     ← units sold
SALES     = DIFF × UNIT PRICE
```

`PROD'c` conflates two different events: **baked on site** (breads) and
**delivered** (beverages, ice cream). Worth separating — they involve different
people and different accountability.

### Cash reconciliation

Total derived sales, against what the cashiers actually turned in:

```
Total Sales − Total Collections = Overage / (Shortage)
```

**Shortages are deducted from employees' pay.** This is the sharpest consequence
in the whole process and the reason accuracy matters: a shortage can come from
theft, a miscount, an unlogged charge, or a pricing error, and the sheet cannot
tell them apart. Better data means fewer wrong deductions — good for staff and
for the business.

---

## Why it is built this way

The design is a deliberate anti-theft control, not just bookkeeping.

Deriving sales from physical stock is harder to game than a point-of-sale log,
where an unrecorded sale simply never appears. Here, stock that leaves without
cash shows up as a shortage.

**`OVER END` catches the opposite direction.** The scheme it exists for:

```
Quota: bake 50 · Baker bakes 60 · Records 50
→ 10 units exist outside the books
→ sold, cash pocketed, and the DSIR still balances perfectly
```

That fraud is **invisible in a balanced book**. The only thing that catches it is
a physical count at an unpredictable moment finding more stock than the records
allow. `OVER END` is where that excess is recorded — evidence of undeclared stock.

**Consequence for automation:** digitising the DSIR does *not* catch this by
itself. The same scheme balances just as cleanly on a screen. What a system can
add is timestamps on production entries, quota-versus-actual comparison,
anomaly patterns across branches, and — the strongest check — eventually
reconciling ingredients consumed against output declared. Flour is gone whether
or not the pandesal was declared.

---

## The current process, and where it hurts

```
pre-printed ream of DSIR forms  →  branch fills quantities by hand
                                →  paper sent to HQ (in batches, often days late)
                                →  ONE encoder types it into Excel
                                →  Excel prices it and computes everything
```

- The paper carries a **printed price**; the Excel carries the **authoritative**
  price. The encoder types quantities only and lets the sheet price them.
- Branches are told price changes separately, so the **counter charges the current
  price** even when the form is stale. The printed price is cosmetic.
- ~100+ handwritten numbers per branch per day, retyped by someone who was not
  there and cannot sanity-check them.
- Only ~26–35% of the 149 rows are used on any given day on a *receiving* branch's
  sheet. `OVER END` is genuinely rare; the transfer columns are not — they are
  simply empty on a branch that only receives (see Transfers above).

### Known defects in the current tooling

- **Encoding lag × price change = wrong history** — but rare. A form from the 10th,
  typed on the 15th, is priced at the 15th's price, which can appear as a shortage
  someone pays for. **Prices change only once or twice a year**, so the exposure is
  a handful of branch-days per change, not a systematic problem.
  *Mitigation is a process rule, not a feature:* finish encoding all outstanding
  forms dated before a price change, then apply the change. Effective-dated prices
  (a `ProductPrice` history table) are only worth building if price changes ever
  become frequent.
- **Charges have no name attached.** The quantity is on the form; who owes for it
  is in a separate notebook. Payroll needs both, and the join is manual and
  memory-dependent. Any charge that falls through is money the business meant to
  recover and simply doesn't.
- **Sheets get lost.** The working file contains two tabs with real data and no
  branch or date — someone duplicated a sheet and lost track.
- The opener/closer count discrepancy is overwritten and lost.

---

## What the system must preserve

1. **Sales stay derived**, never entered directly. The arithmetic is the control.
2. **Named authorship** for the opening and closing counts.
3. **Charges carry the employee**, so payroll has one record instead of two.
   Modelled as individual charge records (product, quantity, employee), not a
   per-product number — two people can damage the same product on the same day.
4. **One authoritative price list.** The Excel is already the pricing authority and
   Otomate takes that role over. Prices change once or twice a year, so a single
   current price per product is sufficient; see the note on encoding lag above.
5. **Transfers are two-sided.** Recorded once by the sender; the receiver sees them
   automatically. Never ask both branches to type the same movement.
6. **`OVER END` stays reachable** without cluttering the common path.
7. **Back-dated entry is normal**, not an error state. Forms arrive late.

## Scope of the first version

Replace **the encoder's Excel**, not the branch's paper. Branches continue with
the pre-printed ream until tablets are affordable, and to avoid wasting the forms
already bought.

So the first user is **one encoder at HQ, typing from paper all day**:

- Keyboard-first, not touch. Tab and type; never reach for the mouse.
- Screen order must mirror the paper exactly — same sections, same product
  sequence — so eye and cursor move together.
- Skip empty rows quickly; roughly two thirds are blank.
- Pre-fill `BEG. BAL` from yesterday's close (36–45 fewer numbers per form).
- Reject impossible values at entry, not weeks later as a variance.

Branch-side tablet capture comes later, and the model above already supports it.

### Entry screen — decided behaviour

The paper form is deliberately over-provisioned: 149 products and 11 input
columns, of which roughly a third of rows and three columns are used on any given
day. The screen should not reproduce that emptiness.

**Rare columns are declared, not auto-hidden.** At the top of the form the encoder
ticks which of `charges`, `pulled out`, `transfers`, `over end` this sheet uses;
only those columns render.

> Declared rather than silently hidden **on purpose**. An unticked box means
> "checked, there were none", not "nobody looked". This matters: a charge that is
> never entered overstates DIFF, overstates sales, and surfaces as a shortage
> deducted from a cashier's wages. Silence must not be able to cause that.

**Rows are added as needed, not all 149 at once.**

- The form opens pre-populated with the products that appeared on **this branch's
  last ~7 DSIRs**, in catalogue order.
- `BEG. BAL` is pre-filled from yesterday's `ENDG. BAL` where there was one.
  **Zero is a correct value, not a blank** — a product that sold out closes at 0
  and legitimately opens at 0.
- Anything else is added by searching the catalogue.

> Do **not** derive the row set from "had stock yesterday". Measured against a
> real sheet, 15 of 52 active products had **no** beginning balance but were
> produced that day — the daily bakes that always sell out (Pandesal 219,
> Mushroom 188, Donut 94). That rule silently drops the highest-volume lines.
>
> Branch working range is ~50–60 products of the 149 catalogue: across three
> sample days, 59 were ever active and 32 appeared on every one.

**The opener/closer discrepancy needs no extra field.** Yesterday's `ENDG. BAL`
and today's `BEG. BAL` are both stored, so any disagreement is computed on
demand. Nothing extra to type.

**The product picker must show price and unit, never the name alone.** The
catalogue contains genuine duplicate names at different price points
(`puto cheese` ₱6 / ₱85, `cheese dog` ₱5 / ₱50 — piece versus tray/pack). On
paper these are distinguished by position; in a search box they are
indistinguishable, and selecting the wrong one silently prices the day's entry at
up to 10× the correct value.

**Charges are a list, not a column.** Charges touch ~8 of 149 rows, so a column
spreads that emptiness across every row *and* has nowhere to record who owes for
it. A short add-as-needed list carries product, quantity and **employee**
together:

```
Charges                              + Add
  Spanish Bread   ×5   Maria S.
  Cheese Dog      ×5   Jose R.
  Donut           ×3   Maria S.
```

This also expresses something a column structurally cannot: **two employees
charging the same product on the same day**. As a column that is one number with
no way to split it; as a list it is two records — which is what payroll needs.
The per-product charge quantity used by the DIFF calculation is the sum of the
list.

**Cashier collections are a list, not fixed slots.** Start with one row and an
"add" action. The paper's `Cashier 1 / 2 / 3 / IT` layout is an artefact of
pre-printing and should not be reproduced.

**Saved DSIRs hide whatever went unused** when viewed or printed — there the
"hide if empty" rule is unambiguous, because the data already exists.
