"""Build the Rescue Studio usage guide without opening desktop applications."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/pdf/Rescue_Studio_0_5_User_Guide.pdf"
BLACK = colors.HexColor("#000000")
INK = colors.HexColor("#202832")
BLUE = colors.HexColor("#183b56")
STYLES = {
    "title": ParagraphStyle(
        "title", fontName="Helvetica-Bold", fontSize=28, leading=32, textColor=BLACK, spaceAfter=14
    ),
    "h1": ParagraphStyle(
        "h1",
        fontName="Helvetica-Bold",
        fontSize=21,
        leading=26,
        textColor=BLACK,
        spaceAfter=12,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        "h2",
        fontName="Helvetica-Bold",
        fontSize=12.5,
        leading=17,
        textColor=BLACK,
        spaceBefore=10,
        spaceAfter=5,
        keepWithNext=True,
    ),
    "body": ParagraphStyle(
        "body",
        fontName="Helvetica",
        fontSize=11,
        leading=15,
        textColor=INK,
        spaceAfter=8,
        alignment=TA_LEFT,
    ),
    "small": ParagraphStyle(
        "small", fontName="Helvetica", fontSize=9.7, leading=13, textColor=INK, spaceAfter=6
    ),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=10.3, leading=14, textColor=INK),
    "step": ParagraphStyle(
        "step",
        fontName="Helvetica",
        fontSize=11,
        leading=15,
        textColor=INK,
        leftIndent=19,
        firstLineIndent=-19,
        spaceAfter=8,
    ),
}
story = []


def p(text, style="body"):
    item = Paragraph(text, STYLES[style])
    story.append(item)
    return item


def heading(text, anchor):
    if story:
        story.append(PageBreak())
    item = p(text, "h1")
    item.section_anchor = anchor


def h2(text):
    p(text, "h2")


def steps(items):
    for number, text in enumerate(items, 1):
        p(f"<b>{number}.</b> {text}", "step")


def table(headers, rows, widths):
    data = [
        [Paragraph(f'<font color="white"><b>{text}</b></font>', STYLES["cell"]) for text in headers]
    ]
    data.extend([[Paragraph(str(text), STYLES["cell"]) for text in row] for row in rows])
    item = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    rules = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D9D9D9")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for row in range(2, len(data), 2):
        rules.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#f1f5f8")))
    item.setStyle(TableStyle(rules))
    story.extend([item, Spacer(1, 10)])


class Guide(BaseDocTemplate):
    def afterFlowable(self, flowable):
        anchor = getattr(flowable, "section_anchor", None)
        if anchor:
            self.canv.bookmarkPage(anchor)
            self.canv.addOutlineEntry(flowable.getPlainText(), anchor, 0, False)


def footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#566473"))
    canvas.drawString(48, 26, "Rescue Studio 0.5  |  User guide")
    canvas.drawRightString(564, 26, str(document.page))
    canvas.restoreState()


item = p("Rescue Studio user guide", "title")
item.section_anchor = "start"
p("Version 0.5.0  |  12 September 2026", "small")
p(
    "Use this guide to turn footage into corrected labels, evaluate saved recognition runs, "
    "check your dataset, train new weights and compare models. Everything here uses the desktop "
    "buttons; you do not need terminal commands or camera calibration."
)
p(
    "<b>The important order:</b> generate or draw boxes, correct them, mark the frames reviewed, "
    "then evaluate or export. Saving labels does not train the model. Only <b>Start "
    "training...</b> "
    "updates weights."
)
h2("Choose your task")
table(
    ["Where to go", "What it does", "Page"],
    [
        (
            '<link href="#footage">Home</link>',
            "Open footage, generate draft boxes or process a batch of videos.",
            "2",
        ),
        (
            '<link href="#labels">01 Annotate footage</link>',
            "Correct labels and carry boxes to following frames.",
            "3",
        ),
        (
            '<link href="#tools">Annotation toolbar</link>',
            "Play footage, list boxes, cut clips and review frames in batches.",
            "4",
        ),
        (
            '<link href="#tools">05 Assisted review</link>',
            "Suggest frames to inspect. Suggestions are not approval.",
            "4",
        ),
        (
            '<link href="#evaluate">02 Evaluate runs</link>',
            "Score saved predictions against reviewed labels. No new YOLO run.",
            "5",
        ),
        (
            '<link href="#metrics">Metrics and provenance</link>',
            "Understand precision, recall, coverage, ID changes and timing.",
            "6",
        ),
        (
            '<link href="#inspect">Inspect error frames</link>',
            "See the evidence behind a score and compare runs fairly.",
            "7",
        ),
        (
            '<link href="#dataset">03 Dataset checks</link>',
            "Check project metadata and split overlap, not box accuracy.",
            "8",
        ),
        (
            '<link href="#train">04 Export and train</link>',
            "Export reviewed data, train weights, then test or compare them.",
            "9",
        ),
        (
            '<link href="#help">Model library and help</link>',
            "Activate a version, find files and solve common problems.",
            "10",
        ),
    ],
    [155, 317, 44],
)
p(
    "Click a task in this table or use the PDF bookmarks to jump to it. For evaluation and "
    "dataset checks, start with pages 5 to 8.",
    "small",
)

heading("Open footage and get draft boxes", "footage")
h2("Resume your work")
steps(
    [
        "Open <b>Rescue Studio</b>. Choose your existing workspace when asked. Your current "
        "project "
        "workspace is <b>C:/Users/Hayden/Documents/clack/autonomous_tracker</b>.",
        "Select a video in Home and click <b>Continue labeling</b>. For a new video, use "
        "<b>Import video...</b>, then <b>Start labeling</b>. Resume does not run analysis or "
        "training.",
        "If your project is not listed, use <b>Resume project...</b> and select its annotation "
        "JSON. "
        "For file locations, select the footage in Home and open <b>Files and credits</b>.",
    ]
)
h2("Generate model predictions")
steps(
    [
        "Check the model shown in Home and its <b>Predicts</b> label list. A class you add to "
        "annotations is not automatically a class the current model can recognize.",
        "Click <b>Generate draft boxes</b>, read the enabled labels and confirm. Wait for "
        "completion. "
        "This creates a saved observation run without changing your annotations.",
        "Click <b>Refresh library</b> if needed. Select the desired recognition result under "
        "<b>Optional: import recognition boxes</b>, then click <b>Label with selected "
        "predictions...</b>.",
        "Inside the editor, the equivalent action is <b>Import recognition boxes...</b>. Choose "
        "the "
        "run folder containing <b>summary.json</b> and <b>frames.jsonl</b>, not the video file.",
    ]
)
p(
    "Existing labels are protected during import. <b>Use predictions on this frame</b> explicitly "
    "replaces that frame's labels after confirmation. <b>Show original predictions</b> displays "
    "dashed reference boxes; these are separate from the editable labels."
)
h2("Process several videos")
p(
    "In Home, open <b>Batch video processing</b>. Add or remove footage so the list contains "
    "exactly "
    "the videos you want. Click <b>Create batch from footage...</b>, then <b>Start / resume / "
    "retry "
    "unfinished</b>. Creating a batch alone does not run inference. It pins the current model."
)
p(
    "Use <b>Review selected result</b> to open its draft predictions, or <b>Open selected attempt "
    "folder</b> to find the run. <b>Stop batch</b> requests a stop; resuming keeps valid completed "
    "results and retries unfinished videos. A batch does not train or approve labels."
)
p(
    "<b>Use the original video.</b> Do not annotate a rendered copy with model boxes burned into "
    "its pixels. Runs and labels must refer to the same exact video file content."
)

heading("Correct labels and carry them forward", "labels")
h2("Make a frame ready for training and scoring")
steps(
    [
        "Open <b>01 Annotate footage</b>. Check the whole image, including areas where the model "
        "drew nothing. Your tags define the full class scope you must label.",
        "Click a box to select it. Drag its interior to move it or a corner to resize it. "
        "Use <b>Delete selected box</b> for false detections. Draw missing objects yourself; "
        "enable "
        "<b>Draw new box</b> when drawing inside an existing box.",
        "For a selected box, click a tag or type its name and press Enter / <b>Create / apply "
        "tag</b>. "
        "Use <b>New tag...</b> to create a class. Deselect before choosing the tag for the next "
        "box.",
        "After checking every visible object in scope, click <b>Mark frame reviewed</b>. A "
        "reviewed "
        "frame with no boxes means you checked it and none of those classes are present.",
        "Click <b>Save project</b> or Ctrl+S. Use <b>Undo label edit</b> or Ctrl+Z to undo "
        "mistakes. "
        "Editing a reviewed frame returns it to draft; review it again when finished.",
    ]
)
p(
    "<b>Changing class scope affects existing review.</b> Adding, renaming or removing a project "
    "class returns frames to draft so you can check for the changed scope. It preserves boxes. "
    "A tag is a training class, not an extra note attached alongside another class."
)
h2("Avoid redrawing every frame")
p(
    "Correct the current frame, choose <b>Follow motion</b>, and click <b>Track &amp; next</b>. "
    "The editor carries the current boxes into the next frame as editable drafts. Enable "
    "<b>Auto-track on Next</b> to do this on ordinary Next clicks. It does not apply to Play or "
    "jumps."
)
p(
    "Use <b>Keep positions</b> or <b>Copy all boxes to next</b> for a fixed-position copy. "
    "These do not check whether the objects moved or are still present. <b>Track range...</b> "
    "previews a longer range; <b>Update following...</b> propagates a correction to later "
    "untouched "
    "generated drafts while protecting manual corrections and reviewed frames."
)
p(
    "<b>Needs attention</b> means the match needs checking. A red dashed box may be the last known "
    "position, not a successful track. Move/resize it, use <b>Confirm / update selected box</b> "
    "if correct, or delete it if absent. Changing its tag alone does not clear the warning."
)
p(
    "Keep an optional <b>Object ID</b> consistent for the same object across frames. The automatic "
    "T- display ID is internal carry history, not a human truth Object ID for measuring ID "
    "changes. "
    "Tracking does not discover new objects, so add new arrivals manually."
)

heading("Playback clips and batch review", "tools")
h2("Watch the footage and find existing boxes")
p(
    "The top annotation toolbar has <b>Play / Pause</b>, a speed selector, a seek slider, "
    "timestamp "
    "and frame number. Playback shows existing boxes but never carries them or marks frames "
    "reviewed. Click the image to pause and edit. Playback has no audio; slow decoding can reduce "
    "the actual playback speed."
)
p(
    "<b>All boxes...</b> lists box occurrences throughout the current project, including unsaved "
    "edits. Search by tag, ID or frame and filter Draft, Reviewed or Needs attention. Double-click "
    "a row to select that box in the editor. Use <b>Search / refresh</b> after edits. Repeated IDs "
    "are occurrences across frames, not extra unique objects."
)
h2("Cut a section into its own video and label project")
steps(
    [
        "Click <b>Cut clip...</b>. Navigate the main video to your first wanted frame and press "
        "<b>Set from current</b> beside In. Do the same for Out, or type the frame numbers.",
        "Choose a destination and click <b>Export clip + labels</b>. Both In and Out are included. "
        "Frame numbering begins at zero in the exported clip.",
        "Wait for verification, then use <b>Open exported project</b>. The new folder contains "
        "clip.avi, clip.json and clip-origin.json. Originals are not shortened or overwritten.",
    ]
)
p(
    "The clip keeps boxes, IDs, warnings and review states from the snapshot at export start. "
    "Later edits to the original do not update it. Export is lossless video only, without audio, "
    "so files can be large. Keep the clip in the same dataset split as its source."
)
h2("Review several frames at once")
p(
    "Click <b>Bulk review...</b>, set the range, and <b>Show / refresh range</b>. Inspect the six "
    "thumbnails; click one to correct its frame in the main editor, then refresh. Use "
    "<b>Mark this page reviewed...</b>, <b>Mark entire range reviewed...</b> or "
    "<b>Return range to draft...</b>. Read the confirmation counts before approving."
)
p(
    "Entire-range approval can include frames not on the current page. Empty/unlabeled frames "
    "are excluded unless you explicitly include reviewed negatives. Unresolved Needs attention "
    "frames stay blocked. One Undo restores a batch; Save persists it."
)
h2("Use a suggested review queue")
p(
    "In <b>05 Assisted review</b>, choose a recognition run or <b>Without predictions</b>, then "
    "<b>Build suggested queue</b>. Use <b>Open next suggested</b> and correct all scoped objects. "
    "<b>Review and next</b> saves and advances within the queue. Skip does not approve a frame. "
    "Finishing the queue does not mean the whole video is reviewed."
)

heading("Evaluate a saved run", "evaluate")
p(
    "Use <b>02 Evaluate runs</b> when you already have saved model predictions and want to know "
    "how they compare with your corrected labels. You can evaluate a baseline before training, "
    "then evaluate new predictions after training."
)
h2("Before you click evaluate")
p(
    "You need the original video, its annotation project with at least one reviewed frame, "
    "and a saved run folder containing <b>summary.json</b> and <b>frames.jsonl</b>. If you have "
    "no run yet, return to Home and use <b>Generate draft boxes</b> as described on page 2."
)
p(
    "Correct the labels first. Imported predictions must not simply be marked reviewed without "
    "inspection: otherwise you can end up scoring the model against its own mistakes."
)
h2("Click by click")
steps(
    [
        "In <b>01 Annotate footage</b>, check your chosen frames, mark them reviewed and save. "
        "Include frames with difficult objects and genuine negative frames, not just easy "
        "detections.",
        "Open <b>02 Evaluate runs</b>. Enter the <b>Incident / recording group</b> and choose the "
        "<b>Dataset split</b>. Use the same incident name for related recordings.",
        "Click <b>Add saved run and evaluate</b>. Select the run's folder, not an MP4, annotation "
        "JSON, dataset folder or training checkpoint.",
        "Wait for a new row in the run table. Select it to see <b>Metrics and provenance</b>, "
        "including per-class scores, coverage, timing notes and the saved result location.",
        "Check <b>Coverage</b> before judging the scores. Then open <b>Inspect error frames</b> "
        "and look at the actual misses and false detections. Pages 6 and 7 explain these results.",
        "To compare another model or configuration, generate its predictions on the same video "
        "and add that saved run here too. Keep the same reviewed labels for both.",
    ]
)
h2("What changes and what stays unchanged")
p(
    "Evaluation saves the open project and creates a new result snapshot. It reads the predictions "
    "already on disk; it does not rerun YOLO, train weights or replace your boxes. The current "
    "GUI matches same-class boxes at an intersection-over-union threshold of 0.5."
)
p(
    "Results are saved in <b>evaluations/evaluation-...</b> beside the annotation project. "
    "The footer and details panel show the exact location. Failed or unfinished runs cannot be "
    "scored; an accepted stopped or frame-limited run may still have incomplete coverage."
)
p(
    "<b>If you correct reviewed labels later:</b> older rows may say STALE. Add the same saved "
    "run again to rescore it against the new reviewed labels. A new inference run is needed only "
    "when you want new predictions, such as after changing the model."
)

heading("Understand the scores", "metrics")
table(
    ["Metric", "Meaning and how to read it"],
    [
        ("TP", "True positives: same-class predictions that matched reviewed boxes."),
        (
            "FP",
            "False positives: predictions without a matching reviewed box. Extra duplicate boxes "
            "can count here.",
        ),
        (
            "FN",
            "False negatives: reviewed objects without a matching prediction. These are misses.",
        ),
        (
            "Precision",
            "TP divided by TP + FP. Of the detections made, how many matched the labels?",
        ),
        ("Recall", "TP divided by TP + FN. Of the labeled objects present, how many were found?"),
        (
            "Coverage",
            "Scored reviewed frames / all reviewed frames. 95/100 means five reviewed frames were "
            "not scored.",
        ),
        (
            "ID changes",
            "Changes in model tracking ID for the same human Object ID across matched reviewed "
            "observations, including gaps.",
        ),
        (
            "p95 ms",
            "About 95% of recorded processing times were at or below this value. Includes read, "
            "inference, rendering and encoding, not full sensor latency.",
        ),
        (
            "N/A",
            "The measure is undefined or lacks the required evidence. It does not mean perfect "
            "performance.",
        ),
    ],
    [100, 416],
)
h2("A small worked example")
p(
    "Suppose there are 20 reviewed fire boxes. The model matches 15, misses 5 and adds 3 false "
    "boxes. Then <b>TP = 15, FN = 5, FP = 3</b>. Precision is 15 / 18 = <b>83.3%</b>; "
    "recall is 15 / 20 = <b>75%</b>. High precision would not erase those five misses."
)
h2("Avoid misleading conclusions")
p(
    "IoU measures the overlap area divided by the combined area of two boxes. This app uses "
    "fixed-threshold box matching, <b>not mAP</b>. A bad box position can therefore cause both "
    "an unmatched prediction and a missed label even when the object was roughly located."
)
p(
    "A missing prediction frame is a <b>coverage gap</b>, not automatically a model miss. A saved "
    "frame with zero detections is different: labeled objects on that scored frame count as "
    "misses. "
    "Look at per-class results; an overall average can hide failure on a rare class."
)
p(
    "Detector confidence is not a calibrated probability of correctness. Repeated boxes across "
    "adjacent frames are not independent events, and FP boxes per labeled minute is not a count "
    "of independent alarms. A small or repetitive clip cannot establish field performance."
)

heading("Inspect errors and compare runs", "inspect")
h2("Find out why a score is low")
steps(
    [
        "Select a run row in <b>02 Evaluate runs</b>, then open <b>Inspect error frames</b>.",
        "Keep <b>Errors and missing predictions only</b> checked to focus on problems, or uncheck "
        "it to include other frames. Double-click a row or click <b>Inspect selected frame</b>.",
        "The left pane is <b>Human labels / scored snapshot</b>. The right pane is "
        "<b>Model detections / scored snapshot</b>. Green boxes matched; red human boxes were "
        "missed; pink model boxes were unmatched. Missing predictions are explicitly unscored.",
        "Check whether the model is wrong, the human annotation is wrong, or both. Use "
        "<b>Edit this frame's labels</b> only to correct the actual labels, not to make them agree "
        "with an incorrect prediction.",
        "Review the corrected frame again, save, and rescore every run you want to compare. "
        "Existing result snapshots keep their original labels and scores.",
    ]
)
h2("Compare models fairly")
p(
    "For a useful comparison, keep the exact source video, reviewed label snapshot, IoU "
    "threshold and scored frame set the same. The details panel reports differences from the "
    "first run as <b>NOT COMPARABLE</b>. Resolve them before ranking models."
)
p(
    "Changing a model can also change its supported tags or prediction settings. Check those "
    "details as well. A model that never supported smoke is not an equal smoke detector simply "
    "because both runs appear in the same table. Predictions outside your declared label scope "
    "are excluded, so keep that scope consistent."
)
h2("Use separate recordings for separate jobs")
table(
    ["Split", "Use"],
    [
        ("Training", "Examples the model learns from."),
        ("Validation", "Held-out incidents used to compare versions and choose settings."),
        ("Test", "Separate incidents reserved for a final evaluation after model selection."),
    ],
    [102, 414],
)
p(
    "Keep related recordings and derived clips together. For example, incident A can be training, "
    "incident B validation, and incident C test. Different filenames or chunks of one recording "
    "are not independent examples."
)
p(
    "<b>Next:</b> inspect misses and false detections for each important class. Correct annotation "
    "errors, label examples of the failure conditions, then train and compare a new version."
)
p(
    "For a final test, generate predictions with the selected model on reserved test footage "
    "and use Evaluate runs. Do not repeatedly tune against this test set; the guided comparison "
    "on page 9 is for validation."
)

heading("Check and organize the dataset", "dataset")
steps(
    [
        "Save every project you intend to check, including projects open in other windows. "
        "The check saves the current editor, then reads the other projects from disk.",
        "Open <b>03 Dataset checks</b> and click <b>Select annotation projects</b>. Select the "
        "current annotation JSON files together. This replaces the selection, so include the "
        "current project too if needed. Do not choose backups, truth exports or run summaries.",
        "Click <b>Check dataset splits</b>. Read the report, issue codes and affected project "
        "paths. "
        "The saved report location appears in the status line.",
        "To fix assignments, open <b>04 Export and train</b>, add the relevant projects, select "
        "each row, enter its incident and split, then click <b>Save selected assignment</b>. "
        "Return to Dataset checks and run it again.",
    ]
)
table(
    ["Finding", "What to do"],
    [
        (
            "Source or incident crosses splits",
            "Keep all recordings from the same source/incident in one split. Do not rename an "
            "incident to hide overlap.",
        ),
        (
            "Clip crosses splits",
            "Move the clip assignment to the same split as its parent and related clips.",
        ),
        (
            "Duplicate source or related clips",
            "Remove duplicate revisions from the selected dataset. Avoid double-counting "
            "overlapping clips.",
        ),
        (
            "Missing incident or unassigned split",
            "Assign a meaningful recording group and training, validation or test.",
        ),
        (
            "Different class scopes",
            "Use Edit shared dataset tags... in Export and train, then recheck frames for the "
            "full scope. Changed scopes return frames to draft.",
        ),
        ("No reviewed frames", "Correct frames, mark them reviewed and save before exporting."),
        (
            "No reviewed negatives",
            "Look for genuine frames with none of the scoped classes. Review those explicitly; "
            "never erase real objects to create negatives.",
        ),
        (
            "Invalid project",
            "Select a real annotation project, not a report or export. Preserve a damaged file "
            "and recover a valid backup if needed.",
        ),
    ],
    [165, 351],
)
p(
    "<b>CONFLICTS_FOUND</b> means an error was found. <b>NEEDS_REVIEW</b> means there are "
    "warnings. "
    "<b>NO_KNOWN_OVERLAP</b> means only that these checks found no issue. A warning can still "
    "block training export when it violates an export requirement."
)
p(
    "This auditor checks saved hashes, recorded clip ancestry and normalized incident tags. "
    "It does not open the footage to inspect labels or prove data independence or rights. "
    "Training export separately verifies the selected source videos. Reports are saved under "
    "<b>audits</b> beside the open annotation project.",
    "small",
)

heading("Export train and test a model", "train")
h2("Create the training dataset")
steps(
    [
        "Open <b>04 Export and train</b>. Click <b>Add annotation projects...</b> and choose one "
        "current project per source video. Assign incidents and splits, then save each assignment.",
        "Check that all projects use the same full tag scope. You need reviewed training and "
        "validation projects from separate incidents, and at least one reviewed training box "
        "for every class. These are minimum software requirements, not enough data for reliable "
        "performance.",
        "Click <b>Check and export...</b> and choose a destination. The app creates a new dataset "
        "with reviewed images and YOLO labels. Reviewed negative frames get empty label files. "
        "Draft frames are excluded. Wait for a successful export before continuing.",
    ]
)
p(
    "An export is a snapshot. If you change reviewed labels, scope, split assignments or the "
    "project selection, <b>STALE EXPORT</b> means you must export again. Do not edit the generated "
    "dataset files manually. <b>Export reviewed JSON</b> in the annotation tab is a different "
    "ground-truth export; it is not the training dataset action."
)
h2("Train new weights")
steps(
    [
        "Click <b>Choose trusted .pt weights...</b> and select a local detection checkpoint. Only "
        "load files from a trusted source. The existing starter workspace has "
        "<b>models/rescue-fire-smoke/best.pt</b>; an empty installation does not include weights.",
        "Review epochs, image size, batch and device. The installed build uses <b>cpu</b>. "
        "An epoch is a pass through training examples; batch is how many images are processed "
        "together. Image size must be a multiple of 32. More epochs do not guarantee a better "
        "model.",
        "Click <b>Start training...</b> and confirm. Watch the logs and wait for completion. "
        "Use <b>Stop training</b> if needed. Training writes a separate run and does not activate "
        "the new model automatically.",
    ]
)
h2("Test the result on validation footage")
p(
    "Use <b>Test models and view saved comparisons</b> to reach step 4. After training, select a "
    "reviewed <b>Validation project</b> and click <b>Test this model</b> or <b>Compare with "
    "starting "
    "model</b>. Unlike Evaluate runs, these buttons run real inference and then score it."
)
p(
    "The guided check needs a completed Studio training result and validation footage with "
    "matching tags. It rejects known training/final-test source or incident overlap. Always run "
    "Dataset checks across all related projects too. Unsupported starting-model tags are listed; "
    "differing class support is not a like-for-like comparison."
)
p(
    "Use <b>Inspect selected run / correct boxes</b> to review mistakes and <b>Open selected "
    "result "
    "folder</b> for the evidence. After correcting reviewed labels, rerun the check. "
    "<b>Open completed training...</b> reopens an earlier training result.json."
)

heading("Model versions files and troubleshooting", "help")
h2("Choose which model new jobs use")
p(
    "After testing, use <b>Save this trained version to model library...</b>, or open "
    "<b>Model library and versions</b> from Home. Importing a model or selecting its row does not "
    "activate it. Click <b>Use for new observation jobs...</b> explicitly. "
    "<b>Revert to previous active version...</b> restores the previous active selection."
)
p(
    "Model files are referenced, not copied. Keep the trusted .pt file and its training folder. "
    "Previously created batches keep their pinned model; create a new batch to use a new version. "
    "For a model without a Studio training record, generate predictions and use Evaluate runs."
)
h2("Where your files are")
p(
    "<b>Video and labels:</b> Home &gt; Files and credits &gt; Open video folder / Open annotation "
    "folder. Resume project opens projects outside the library."
)
p(
    "<b>Prediction runs:</b> workspace diagnostics/rescue/review-... folders contain summary.json "
    "and frames.jsonl. <b>Evaluations and audits:</b> evaluations and audits folders beside the "
    "annotation project; the editor shows the exact paths."
)
p(
    "<b>Cut clips:</b> by default, clips beside the project. <b>Training:</b> your chosen dataset "
    "export folder, with training-runs inside it. Keep data.yaml, manifest.json and completed "
    "training result folders."
)
h2("Common problems")
table(
    ["Problem", "Next action"],
    [
        (
            "No boxes appear",
            "Check that a run exists and has been imported. Check the model's supported tags. Add "
            "missed objects manually.",
        ),
        (
            "Cannot evaluate",
            "Review at least one frame; choose the run folder with both required files. Use "
            "predictions from the exact same video. Regenerate legacy runs missing a video hash.",
        ),
        (
            "STALE or NOT COMPARABLE",
            "Rescore all compared runs on the same reviewed labels. Check source, frame coverage, "
            "IoU and supported classes.",
        ),
        (
            "Training export is blocked",
            "Fix class-scope, reviewed-frame, incident or split problems. Remove duplicate "
            "revisions, then Check and export again.",
        ),
        (
            "Controls seem missing",
            "Scroll the sidebar or training panel and enlarge the window. The playback and clip "
            "controls require version 0.5.",
        ),
    ],
    [147, 369],
)
p(
    "<b>Before closing:</b> save edits, finish or stop background jobs, and back up the workspace "
    "plus any externally referenced videos and weights. Keep .studio sidecars for workflow state. "
    "The app is for local annotation and observation; these scores do not certify field readiness.",
    "small",
)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Guide(
        str(OUTPUT),
        pagesize=letter,
        leftMargin=48,
        rightMargin=48,
        topMargin=42,
        bottomMargin=44,
        title="Rescue Studio User Guide",
        author="Rescue Studio",
        subject="Desktop annotation evaluation dataset checks and training",
    )
    frame = Frame(48, 44, 516, 706, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=footer))
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
