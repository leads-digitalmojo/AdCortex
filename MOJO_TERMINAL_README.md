# Mojo Terminal Command Guide

This document explains what `Mojo Terminal` can execute right now inside the application and what it cannot execute yet.

## What Mojo Terminal Does

Mojo Terminal is an AI command interface for live campaign execution. It sends natural-language instructions to the backend, interprets them, and executes supported actions immediately against campaign entities in Meta Ads and Google Ads.

It is currently designed for:

- campaign pause commands
- campaign unpause commands
- campaign budget increases
- campaign budget decreases
- budget scaling for winners or underperformers

It is not a general-purpose app control interface.

## Executable Commands

These are the kinds of commands Mojo Terminal can execute right now.

### Pause Commands

- `pause all losers`
- `pause campaigns spending but no leads`
- `pause high CPL campaigns`
- `pause bad campaigns from the last 3 days`
- `pause underperforming campaigns`

Expected behavior:

- matches campaigns using AI-interpreted rules
- runs live pause actions immediately

### Unpause Commands

- `unpause paused winners`
- `resume top campaigns`
- `enable campaigns that were paused by mistake`

Expected behavior:

- attempts to enable matching campaigns

### Scale Up Commands

- `scale winners by 20%`
- `increase budget for high performing campaigns`
- `raise budgets on campaigns with low CPL`

Expected behavior:

- increases campaign budgets
- may map to either `scale` or `adjust_budget`

### Scale Down Commands

- `reduce budget on weak campaigns by 15%`
- `decrease budget on high CPL campaigns`
- `cut budgets on campaigns with poor performance`

Expected behavior:

- lowers budgets on matching campaigns

### Cross-Platform Execution

Mojo Terminal currently sends commands in all-platform mode, so it does not depend on the visible platform filters in the UI.

That means commands can execute against:

- Meta campaigns
- Google campaigns

## Non-Executable Commands

These may sound valid in English, but Mojo Terminal does not currently execute them as real application actions.

### Creative Commands

- `generate a creative`
- `rewrite the hook`
- `make an image for this ad`
- `create 3 new ad concepts`

Why not:

- creative generation belongs to the Creatives workflow, not the terminal execution engine

### Navigation or UI Commands

- `open the creatives tab`
- `go to settings`
- `switch to campaigns page`
- `close the sidebar`

Why not:

- Mojo Terminal does not control frontend navigation or UI state like a desktop assistant

### Settings or Admin Commands

- `change benchmarks`
- `update credentials`
- `enable google ads for this client`
- `change client targets`

Why not:

- these are not wired to terminal execution endpoints

### File and Export Commands

- `upload logo`
- `download report`
- `export the brief`
- `save this as pdf`

Why not:

- Mojo Terminal does not manage file upload/download flows

### Manual Tracking / Workflow Commands

- `add a manual task`
- `create an agent note`
- `log this in execution history`

Why not:

- these are app workflow features, not live terminal execution actions

### Deep Analytics / Report Query Commands

- `show me breakdown analysis`
- `compare this week vs last week`
- `summarize recommendations`
- `show demand gen creative fatigue`

Why not:

- the terminal is built for execution-oriented command handling, not full dashboard reporting

## Clarify-Only Commands

Some commands will not execute immediately even if they sound close to supported behavior.

Examples:

- `fix this account`
- `improve performance`
- `do whatever is best`
- `scale campaigns`

Why:

- the AI may decide the request is too ambiguous or risky
- in those cases it returns a clarification response instead of executing

## Practical Rule of Thumb

### Usually Executable

Commands that clearly tell Mojo to do one of these on campaigns:

- pause
- unpause
- scale up
- scale down
- adjust budget

### Usually Not Executable

Commands that ask Mojo to:

- navigate the app
- create creatives
- manage settings
- update files
- perform reporting-only analysis
- change non-campaign workflows

## Safe Examples to Use

- `pause all losers`
- `pause campaigns spending but no leads`
- `scale winners by 20%`
- `increase budget for top campaigns`
- `reduce budget on high CPL campaigns`
- `unpause campaigns with strong performance`

## Not Supported Yet Examples

- `generate a new real estate creative`
- `open creative calendar`
- `change client benchmarks`
- `add a task for me`
- `download performance report`

