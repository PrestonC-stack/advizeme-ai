# AI DVI Roadmap

## Goal

Turn AdvizeMe from a live workflow monitor into a true advisor copilot that can:

- analyze DVIs
- spot missing evidence
- identify low-hanging-fruit opportunities
- prioritize what should be presented now versus later

## Phase 1: heuristic AI-style prioritization

This is the current stage.

- rank tickets based on live status
- boost tickets with open alerts
- surface `Advisor Estimate`, `Waiting Approval`, and P1 tickets as quick wins
- show recent live changes for easier action

## Phase 2: DVI evidence analysis

Add DVI-specific review against:

- notes present or missing
- photos present or missing
- whether the recommendation is explained well enough to sell
- whether findings appear safety, concern, reliability, or future work

## Phase 3: low-hanging-fruit scoring

For each ticket, score:

- how close it is to a customer decision
- whether it already has supporting evidence
- whether customer engagement already happened
- whether the next action is likely fast and valuable

## Phase 4: AI summary generation

Generate:

- concise advisor talking points
- customer-friendly recommendation summaries
- what to sell first
- what to defer
- what needs more evidence before presenting

## Inputs we need

- real DVI payloads or exports
- AutoFlow view / signoff events
- customer viewed DVI events
- estimate and approval events
- more examples of strong and weak DVIs

## Recommended next AI build slice

1. capture a real `customer_viewed_dvi` payload
2. capture a `repair_order_approved` payload
3. add a DVI opportunity scorer that combines:
   - DVI sent
   - customer viewed
   - message delivered
   - status waiting approval / advisor estimate
4. add generated advisor prompts in the desktop app
