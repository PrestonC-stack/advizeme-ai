# AdvizeMe.ai Import Drop Zone

Use this folder when you want to copy and paste raw data from Tekmetric, AutoFlow, AutoTextMe, or Trello into the project so it can be cleaned up and imported.

## Best rule

Do not worry about making it perfect first.

Paste the raw information in, keep one job or one screen dump per file when possible, and we can normalize it afterward.

## Folders

- `tekmetric/` for RO lists, job board dumps, RO detail notes, estimate notes, parts notes, and customer update logs
- `autoflow/` for DVI text, inspection notes, workflow status text, and message summaries
- `trello/` for Apache card details, board list summaries, and task notes
- `paired-jobs/` for matched same-vehicle examples across systems

## Easiest ways to give data

### Option 1: paste raw text

Open a `.txt` or `.md` file in one of these folders and paste:

- copied ticket rows
- copied RO details
- copied estimate job text
- copied customer note text
- copied appointment/status text

### Option 2: drop exported files

If Tekmetric or another system gives you:

- PDF
- CSV
- screenshot
- print-to-PDF

drop the real file into the matching folder.

### Option 3: one vehicle at a time

For the cleanest results, create a matched set in `paired-jobs/`:

- Tekmetric RO text or PDF
- AutoFlow DVI PDF or screenshot
- Trello card text if Apache
- short note explaining what happened

## Good enough is good enough

If the text is messy, duplicated, or incomplete, that is still useful for the MVP.
