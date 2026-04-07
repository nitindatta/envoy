# Personal Upwork Job Assistant

This workspace now contains a local, review-first assistant tailored to your profile.

What it does:
- Reads a plain-text Upwork job description.
- Scores how well the job matches your profile.
- Generates a tailored application packet with:
  - a fit summary,
  - reasons to apply,
  - risks and follow-up questions,
  - a draft proposal,
  - suggested screening-question answers.

What it does not do:
- It does not blindly auto-submit jobs on Upwork.
- It is designed to help you review and approve each application before submission.

## Files

- `profile/nitin_datta_profile.json`: structured version of your resume/profile.
- `src/upwork_assistant.py`: CLI assistant.
- `jobs/`: place plain-text job descriptions here.
- `applications/`: generated application packets are saved here.

## Usage

Review a job:

```bash
python3 src/upwork_assistant.py review jobs/sample_llm_data_platform_job.txt
```

Generate a draft packet:

```bash
python3 src/upwork_assistant.py draft jobs/sample_llm_data_platform_job.txt --print-packet
```

Generate a packet for a real Upwork brief you pasted into a file:

```bash
python3 src/upwork_assistant.py draft jobs/my_upwork_job.txt
```

## Recommended workflow

1. Copy an Upwork job description into a plain-text file under `jobs/`.
2. Run `review` to see whether it is worth your time.
3. Run `draft` to generate the proposal packet.
4. Edit the generated markdown if needed.
5. Manually submit the final application through Upwork.

## Next useful upgrade

A practical next step is a browser-assisted mode that opens a local review screen, lets you approve the final proposal, and only then helps prefill fields for you. That keeps you in control while still removing repetitive work.

## Browser-Assisted Mode

This workspace now includes a local Node-based browser assistant in `src/upwork_browser_assistant.js`.

What it does:
- Launches a dedicated Chrome or Edge session with a persistent local profile.
- Lets you log in to Upwork manually with your own credentials.
- Reads visible jobs from the current Upwork page.
- Captures the current job detail page into `jobs/`.
- Generates a proposal packet into `applications/`.
- Prefills the current Upwork application textarea with the generated proposal.
- Keeps submission behind an explicit approval phrase.

Setup:

```powershell
"C:\Program Files\nodejs\npm.cmd" install
```

Launch the browser session:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js launch-browser
```

Then log in to Upwork manually in the opened browser window.

List visible jobs from the current Upwork page:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js list-jobs
```

Generate a draft packet from the current job detail page:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js draft-current-job --print-packet
```

Or generate a packet from a local text file:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js draft-file --job-file jobs\sample_llm_data_platform_job.txt --print-packet
```

Prefill the proposal on the current Upwork application page:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js prefill-current-application
```

Only after review, let the helper click submit too:

```powershell
"C:\Program Files\nodejs\node.exe" src\upwork_browser_assistant.js submit-current-application --approval I_APPROVE_SUBMIT
```

Notes:
- The dedicated browser profile is stored under `automation/browser-profile`.
- The latest visible-job scrape is stored in `automation/visible-jobs.json`.
- The submit action is intentionally gated so the project does not silently auto-apply.
- Upwork can change its DOM structure, so selectors may need small updates over time.

## Proxy Portal

This workspace also includes a local review portal that sits above the provider automation layer.

Files:
- `src/portal_server.js`
- `portal/index.html`
- `portal/app.js`
- `portal/styles.css`
- `src/providers/upwork.js`

Why this exists:
- You review jobs in one local portal instead of directly inside each provider UI.
- The portal can aggregate jobs, generate proposals, let you edit the final text, and then send actions into the live provider browser session.
- The backend is split into provider modules so Upwork works now and LinkedIn/Seek can be added later with the same portal UX.

Run the portal:

```powershell
"C:\Program Files\nodejs\node.exe" src\portal_server.js
```

Open:

```text
http://127.0.0.1:4312
```

Portal flow:
1. Launch the Upwork browser session from the portal if it is not already running.
2. Log in to Upwork in that dedicated browser window.
3. Use `Refresh Jobs` in the portal to pull the visible jobs from the current Upwork page.
4. Select a job and use `Generate Review` to capture the live brief and create a proposal packet.
5. Edit the proposal text inside the portal.
6. Keep the provider apply page open in the automation browser, then use `Prefill Current Application`.
7. To submit from the portal, type `I_APPROVE_SUBMIT` into the approval field and use `Submit From Portal`.

Current scope:
- Upwork provider is implemented.
- LinkedIn and Seek are not implemented yet, but the provider layer is structured so they can be added without replacing the portal.

## Codex CLI Proposal Generation

The portal can now hand proposal generation to the local `codex` CLI instead of only using the heuristic writer.

How it works:
- Generate a normal review first so the job is captured and grounded.
- In the portal, use `Generate Via Codex`.
- The backend runs `codex exec` non-interactively with the review, job text, and profile.
- The returned proposal and screening answers are written back into the saved review and shown in the portal.

Requirements:
- `codex` CLI must be installed and available on PATH.
- The local Codex CLI must already be logged in.
- Network access for Codex must be available in the environment where the portal server runs.

Notes:
- This uses your local Codex CLI session, not an OpenAI API key.
- If Codex CLI cannot reach its backend or is not logged in, the portal request will fail and show the error message.
