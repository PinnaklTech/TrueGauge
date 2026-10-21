import { completeProductTour } from "@/lib/api";

export type TourRoute =
  | "dashboard"
  | "equipment"
  | "calibrations"
  | "certificates"
  | "reports"
  | "notifications";

export type TourCallbacks = {
  onExpandSidebar?: () => void;
  onRestoreSidebar?: () => void;
  onFinished?: () => void;
  onPaused?: () => void;
  navigateTo?: (to: TourRoute) => Promise<void>;
  /** QA / technician — Lists, Add Equipment, and write-oriented copy. */
  includeLists?: boolean;
};

type TourDriver = {
  destroy: () => void;
  isActive: () => boolean;
  refresh: () => void;
  moveNext: () => void;
  movePrevious: () => void;
  drive: (stepIndex?: number) => void;
  getActiveIndex: () => number | undefined;
};

type TourStep = {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    onNextClick?: (
      element: Element | undefined,
      step: TourStep,
      opts: { driver: TourDriver },
    ) => void | Promise<void>;
    onPrevClick?: (
      element: Element | undefined,
      step: TourStep,
      opts: { driver: TourDriver },
    ) => void | Promise<void>;
  };
};

const STEP_KEY = "tg-tour-step";
const RUNNING_KEY = "tg-tour-running";
const PAUSED_KEY = "tg-tour-paused";
const RESUME_KEY = "tg-tour-resume";

let liveCb: TourCallbacks = {};
let activeDriver: TourDriver | null = null;
let suppressPauseOnDestroy = false;
let startingTour = false;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForSelector(selector: string, attempts = 80): Promise<Element | null> {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      if (el || n >= attempts) {
        resolve(el);
        return;
      }
      n += 1;
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function setDialogTourClass(on: boolean) {
  document.body.classList.toggle("tg-tour-dialog-expanded", on);
}

function openListsDialog() {
  setDialogTourClass(true);
  document.body.classList.add("tg-tour-lists-expanded");
  window.dispatchEvent(new Event("tg-tour-open-lists"));
}

function closeListsDialog() {
  window.dispatchEvent(new Event("tg-tour-close-lists"));
  document.body.classList.remove("tg-tour-lists-expanded");
  if (!document.body.classList.contains("tg-tour-form-expanded")) {
    setDialogTourClass(false);
  }
}

function openEquipmentCreate() {
  setDialogTourClass(true);
  document.body.classList.add("tg-tour-form-expanded");
  window.dispatchEvent(new Event("tg-tour-open-equipment-create"));
}

function closeEquipmentCreate() {
  window.dispatchEvent(new Event("tg-tour-close-equipment-create"));
  document.body.classList.remove("tg-tour-form-expanded");
  if (!document.body.classList.contains("tg-tour-lists-expanded")) {
    setDialogTourClass(false);
  }
}

function closeAllTourDialogs() {
  closeListsDialog();
  closeEquipmentCreate();
  setDialogTourClass(false);
  document.body.classList.remove("tg-tour-lists-expanded", "tg-tour-form-expanded");
}

function saveStep(index: number) {
  sessionStorage.setItem(STEP_KEY, String(Math.max(0, index)));
}

export function getSavedTourStep(): number {
  const raw = sessionStorage.getItem(STEP_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function isProductTourActive(): boolean {
  return !!activeDriver?.isActive();
}

export function bindProductTourCallbacks(cb: TourCallbacks): void {
  liveCb = { ...liveCb, ...cb };
}

function destroyDriverSoft() {
  const drv = activeDriver;
  activeDriver = null;
  if (drv?.isActive()) {
    suppressPauseOnDestroy = true;
    try {
      drv.destroy();
    } finally {
      window.setTimeout(() => {
        suppressPauseOnDestroy = false;
      }, 0);
    }
  }
  closeAllTourDialogs();
}

export function stopProductTourUi(): void {
  destroyDriverSoft();
}

/**
 * Writer tour (includeLists):
 * 0 welcome, 1 sidebar, 2 scan, 3 equipment nav,
 * 4 print labels, 5 import/export,
 * 6 lists btn → 7 lists dialog,
 * 8 add-equipment btn → 9 add form,
 * 10 calibrations nav → 11 cal tabs → 12 log form → 13 cal schedules,
 * 14 certificates nav → 15 certificate upload,
 * 16 reports nav → 17 reports generate,
 * 18 notifications nav → 19 notifications inbox,
 * 20 dash cards, 21 account
 *
 * Member tour:
 * 0 welcome, 1 sidebar, 2 scan, 3 equipment nav,
 * 4 cal nav → 5 cal tabs → 6 cal schedules,
 * 7 certificates nav → 8 certificate vault,
 * 9 reports nav → 10 reports generate,
 * 11 notifications nav → 12 notifications inbox,
 * 13 dash cards, 14 account
 */
export function pathForTourStep(step: number, includeLists: boolean): TourRoute {
  if (includeLists) {
    if (step >= 4 && step <= 9) return "equipment";
    if (step >= 11 && step <= 13) return "calibrations";
    if (step === 15) return "certificates";
    if (step === 17) return "reports";
    if (step === 19) return "notifications";
    return "dashboard";
  }
  if (step >= 5 && step <= 6) return "calibrations";
  if (step === 8) return "certificates";
  if (step === 10) return "reports";
  if (step === 12) return "notifications";
  return "dashboard";
}

async function handoffToStep(nextStep: number, to: TourRoute) {
  saveStep(nextStep);
  sessionStorage.setItem(RUNNING_KEY, "1");
  sessionStorage.setItem(RESUME_KEY, "1");
  sessionStorage.removeItem(PAUSED_KEY);
  destroyDriverSoft();
  await liveCb.navigateTo?.(to);
}

function normalizeTourPath(pathname: string): TourRoute {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p.includes("/equipment")) return "equipment";
  if (p.includes("/calibrations")) return "calibrations";
  if (p.includes("/certificates")) return "certificates";
  if (p.includes("/reports")) return "reports";
  if (p.includes("/notifications")) return "notifications";
  return "dashboard";
}

/**
 * Back navigation — never opens dialogs or visits heavy pages.
 * Skips heavy steps so Back stays lag-free.
 */
async function backLight(
  fromStep: number,
  includeLists: boolean,
  drv: TourDriver,
) {
  closeAllTourDialogs();

  let target = Math.max(0, fromStep - 1);

  if (includeLists) {
    // Skip dialog-only steps when reversing
    if (fromStep === 9) target = 8; // form → Add Equipment button
    else if (fromStep === 8) target = 6; // add btn → Lists button (skip lists dialog)
    else if (fromStep === 7) target = 6; // lists dialog → Lists button
    else if (fromStep === 10) target = 8; // cal nav → Add Equipment button (no form)
    // Leaving calibrations / certificates / reports / notifications / dash: skip heavy pages
    else if (fromStep >= 11 && fromStep <= 20) target = 3;
  } else {
    // Member: leaving cal / certificates / reports / notifications / dash → equipment nav
    if (fromStep >= 4 && fromStep <= 13) target = 3;
  }

  const targetPath = pathForTourStep(target, includeLists);
  const current = normalizeTourPath(window.location.pathname);

  // Never navigate into heavy pages while going back
  if (
    targetPath === "equipment" ||
    targetPath === "calibrations" ||
    targetPath === "certificates" ||
    targetPath === "reports" ||
    targetPath === "notifications"
  ) {
    if (current === targetPath) {
      saveStep(target);
      drv.drive(target);
      return;
    }
    // Prefer dashboard instead of opening those pages
    target = 2;
  }

  const finalPath = pathForTourStep(target, includeLists);
  if (normalizeTourPath(window.location.pathname) !== finalPath) {
    await handoffToStep(target, finalPath);
    return;
  }

  saveStep(target);
  drv.drive(target);
}

function buildSteps(includeLists: boolean): TourStep[] {
  const steps: TourStep[] = [
    {
      popover: {
        title: "Welcome to TheTruegage",
        description:
          "A quick tour of Scan, equipment, reports, reminders, and more. Skip for now pauses — resume anytime from the top bar.",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-sidebar"]',
      popover: {
        title: "Navigation",
        description:
          "Move between Dashboard, Equipment, Calibrations, Certificates, Reports, and Notifications from this sidebar.",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="nav-scan"]',
      popover: {
        title: "Scan",
        description:
          "Open the camera or paste a QR code from a printed label to jump straight to that gauge — no hunting in the list.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: '[data-tour="nav-equipment"]',
      popover: {
        title: "Equipment",
        description: includeLists
          ? "Your gauge register lives here — print QR labels, import or export CSV, manage Lists, and add equipment."
          : "Browse gauges and instruments, check due dates, and open a record for full history. Pair with Scan for floor lookups.",
        side: "right",
        align: "start",
        onNextClick: includeLists
          ? async () => {
              await handoffToStep(4, "equipment");
            }
          : undefined,
      },
    },
  ];

  if (includeLists) {
    steps.push(
      {
        element: '[data-tour="equipment-print-labels"]',
        popover: {
          title: "Print QR labels",
          description:
            "Select gauges, then print QR labels for the shop floor. Scanning a label opens that equipment record.",
          side: "bottom",
          align: "end",
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(4, true, drv);
          },
        },
      },
      {
        element: '[data-tour="equipment-import-export"]',
        popover: {
          title: "Import / Export",
          description:
            "Bootstrap or back up your register with CSV — import new rows or export the current list.",
          side: "bottom",
          align: "end",
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(5, true, drv);
          },
        },
      },
      {
        element: '[data-tour="equipment-lists"]',
        popover: {
          title: "Lists",
          description:
            "Use Lists to maintain departments, categories, and locations for equipment forms. Next opens the panel.",
          side: "bottom",
          align: "end",
          onNextClick: async (_el, _step, { driver: drv }) => {
            openListsDialog();
            await waitForSelector('[data-tour="equipment-lists-dialog"]');
            await delay(280);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(6, true, drv);
          },
        },
      },
      {
        element: '[data-tour="equipment-lists-dialog"]',
        popover: {
          title: "Create your lists here",
          description:
            "Add departments, categories, and locations in this window. They appear in equipment dropdowns (and you can also use “+ Add new…” on the form).",
          side: "left",
          align: "start",
          onNextClick: async (_el, _step, { driver: drv }) => {
            closeListsDialog();
            await delay(160);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(7, true, drv);
          },
        },
      },
      {
        element: '[data-tour="equipment-add"]',
        popover: {
          title: "Add Equipment",
          description:
            "Use this button anytime to register a new gauge or instrument. Next opens the form.",
          side: "bottom",
          align: "end",
          onNextClick: async (_el, _step, { driver: drv }) => {
            openEquipmentCreate();
            await waitForSelector('[data-tour="equipment-create-dialog"]');
            await delay(280);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(8, true, drv);
          },
        },
      },
      {
        element: '[data-tour="equipment-create-dialog"]',
        popover: {
          title: "New equipment form",
          description:
            "Fill in name, category, department, location, and calibration dates — then save. Close when you’re done exploring.",
          side: "left",
          align: "start",
          onNextClick: async (_el, _step, { driver: drv }) => {
            closeEquipmentCreate();
            await delay(160);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(9, true, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-calibrations"]',
        popover: {
          title: "Calibrations",
          description:
            "Calibration schedules and history live here. Next opens that page.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(11, "calibrations");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(10, true, drv);
          },
        },
      },
      {
        element: '[data-tour="cal-tabs"]',
        popover: {
          title: "Calibration views",
          description:
            "Switch between upcoming schedules, history, and logging a new calibration run. Next opens the log form.",
          side: "bottom",
          align: "end",
          onNextClick: async (_el, _step, { driver: drv }) => {
            window.dispatchEvent(new Event("tg-tour-open-cal-log"));
            await waitForSelector('[data-tour="cal-log-form"]');
            await delay(280);
            document
              .querySelector('[data-tour="cal-log-form"]')
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
            await delay(200);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(11, true, drv);
          },
        },
      },
      {
        element: '[data-tour="cal-log-form"]',
        popover: {
          title: "Log a calibration",
          description:
            "Pick the gauge, date, result, and provider details — optionally attach a PDF. Saving updates the equipment timeline and next due date.",
          side: "left",
          align: "start",
          onNextClick: async (_el, _step, { driver: drv }) => {
            window.dispatchEvent(new Event("tg-tour-close-cal-log"));
            await waitForSelector('[data-tour="cal-schedules"]');
            await delay(220);
            document
              .querySelector('[data-tour="cal-schedules"]')
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
            await delay(160);
            drv.refresh();
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            window.dispatchEvent(new Event("tg-tour-close-cal-log"));
            await delay(160);
            await backLight(12, true, drv);
          },
        },
      },
      {
        element: '[data-tour="cal-schedules"]',
        popover: {
          title: "Schedules & urgency",
          description:
            "Overdue, due-soon, and upcoming work is grouped here so you can see what needs attention.",
          side: "top",
          align: "start",
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(13, true, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-certificates"]',
        popover: {
          title: "Certificates",
          description:
            "Your PDF certificate vault lives here — private storage for calibration documents. Next opens the vault.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(15, "certificates");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(14, true, drv);
          },
        },
      },
      {
        element: '[data-tour="certificates-upload"]',
        popover: {
          title: "Upload a certificate",
          description:
            "Drop a PDF here (max 2 MB). After you pick a file, you’ll choose which equipment it belongs to — search by tag or name, then upload & link.",
          side: "bottom",
          align: "center",
          onNextClick: async (_el, _step, { driver: drv }) => {
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(15, true, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-reports"]',
        popover: {
          title: "Reports",
          description:
            "Generate audit-ready PDF summaries — compliance, inventory, overdue, or due soon. Next opens Reports.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(17, "reports");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(16, true, drv);
          },
        },
      },
      {
        element: '[data-tour="reports-generate"]',
        popover: {
          title: "Generate a PDF",
          description:
            "Pick a report type and download a branded PDF. The last few downloads stay under Previously generated for quick re-download.",
          side: "top",
          align: "start",
          onNextClick: async (_el, _step, { driver: drv }) => {
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(17, true, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-notifications"]',
        popover: {
          title: "Notifications",
          description:
            "Due and overdue reminders land here. Next opens your inbox.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(19, "notifications");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(18, true, drv);
          },
        },
      },
      {
        element: '[data-tour="notifications-inbox"]',
        popover: {
          title: "Your inbox",
          description:
            "Read and clear in-app alerts. Email reminders follow your Profile prefs when your org allows them.",
          side: "top",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(20, "dashboard");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(19, true, drv);
          },
        },
      },
    );
  } else {
    steps.push(
      {
        element: '[data-tour="nav-calibrations"]',
        popover: {
          title: "Calibrations",
          description: "Next we’ll open Calibrations to see schedules and history.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(5, "calibrations");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(4, false, drv);
          },
        },
      },
      {
        element: '[data-tour="cal-tabs"]',
        popover: {
          title: "Calibration views",
          description: "Browse schedules and the history log from these tabs.",
          side: "bottom",
          align: "end",
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(5, false, drv);
          },
        },
      },
      {
        element: '[data-tour="cal-schedules"]',
        popover: {
          title: "Schedules & urgency",
          description:
            "See what’s overdue or coming due. Click through to equipment when you need detail.",
          side: "top",
          align: "start",
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(6, false, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-certificates"]',
        popover: {
          title: "Certificates",
          description:
            "Open the document vault to browse calibration PDFs linked to your equipment. Next opens Certificates.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(8, "certificates");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(7, false, drv);
          },
        },
      },
      {
        element: '[data-tour="certificates-vault"]',
        popover: {
          title: "Certificate vault",
          description:
            "Search and open certificates here. Preview, download, and review which gauge each PDF is linked to.",
          side: "bottom",
          align: "center",
          onNextClick: async (_el, _step, { driver: drv }) => {
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(8, false, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-reports"]',
        popover: {
          title: "Reports",
          description:
            "Generate or re-download PDF summaries for audits and reviews. Next opens Reports.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(10, "reports");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(9, false, drv);
          },
        },
      },
      {
        element: '[data-tour="reports-generate"]',
        popover: {
          title: "Reports & history",
          description:
            "Choose a report type, download the PDF, and re-open recent files from Previously generated.",
          side: "top",
          align: "start",
          onNextClick: async (_el, _step, { driver: drv }) => {
            drv.moveNext();
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(10, false, drv);
          },
        },
      },
      {
        element: '[data-tour="nav-notifications"]',
        popover: {
          title: "Notifications",
          description:
            "Due and overdue reminders land here. Next opens your inbox.",
          side: "right",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(12, "notifications");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(11, false, drv);
          },
        },
      },
      {
        element: '[data-tour="notifications-inbox"]',
        popover: {
          title: "Your inbox",
          description:
            "Read and clear in-app alerts. Email reminders follow your Profile prefs when your org allows them.",
          side: "top",
          align: "start",
          onNextClick: async () => {
            await handoffToStep(13, "dashboard");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(12, false, drv);
          },
        },
      },
    );
  }

  steps.push(
    {
      element: '[data-tour="dash-cards"]',
      popover: {
        title: "Dashboard cards",
        description:
          "These summary cards are clickable — each one jumps you into the matching filtered view.",
        side: "bottom",
        align: "center",
        onPrevClick: async (_el, _step, { driver: drv }) => {
          await backLight(includeLists ? 20 : 13, includeLists, drv);
        },
      },
    },
    {
      element: '[data-tour="account-menu"]',
      popover: {
        title: "Your account",
        description:
          "Open Profile for preferences and reminder opts (when your org allows). Replay this tour anytime from Profile. Click Finish when you’re done.",
        side: "right",
        align: "end",
        onPrevClick: async (_el, _step, { driver: drv }) => {
          await backLight(includeLists ? 21 : 14, includeLists, drv);
        },
      },
    },
  );

  return steps;
}

async function prepareStepUi(step: number, includeLists: boolean) {
  const path = pathForTourStep(step, includeLists);
  // Only open dialogs when landing on those exact forward steps — never on Back skips
  if (path === "equipment") {
    await waitForSelector(
      '[data-tour="equipment-print-labels"], [data-tour="equipment-add"], [data-tour="equipment-lists"]',
    );
    closeAllTourDialogs();
    if (includeLists && step === 7) {
      openListsDialog();
      await waitForSelector('[data-tour="equipment-lists-dialog"]');
      await delay(280);
    } else if (includeLists && step === 9) {
      openEquipmentCreate();
      await waitForSelector('[data-tour="equipment-create-dialog"]');
      await delay(280);
    }
  } else if (path === "calibrations") {
    window.dispatchEvent(new Event("tg-tour-open-calibrations"));
    await waitForSelector('[data-tour="cal-tabs"]');
    await waitForSelector('[data-tour="cal-schedules"], [data-tour="cal-log-form"]');
    if (includeLists && step === 12) {
      window.dispatchEvent(new Event("tg-tour-open-cal-log"));
      await waitForSelector('[data-tour="cal-log-form"]');
      await delay(280);
      document
        .querySelector('[data-tour="cal-log-form"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      await delay(200);
    } else {
      window.dispatchEvent(new Event("tg-tour-close-cal-log"));
      if ((includeLists && step === 13) || (!includeLists && step === 6)) {
        await waitForSelector('[data-tour="cal-schedules"]');
        document
          .querySelector('[data-tour="cal-schedules"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        await delay(160);
      }
    }
  } else if (path === "certificates") {
    await waitForSelector('[data-tour="certificates-intro"]');
    const card = await waitForSelector(
      '[data-tour="certificates-upload"], [data-tour="certificates-vault"]',
      120,
    );
    await delay(160);
    const target =
      document.querySelector('[data-tour="certificates-upload"]') ??
      document.querySelector('[data-tour="certificates-vault"]') ??
      card;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(280);
  } else if (path === "reports") {
    await waitForSelector('[data-tour="reports-generate"]');
    document
      .querySelector('[data-tour="reports-generate"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(200);
  } else if (path === "notifications") {
    await waitForSelector('[data-tour="notifications-inbox"]');
    document
      .querySelector('[data-tour="notifications-inbox"]')
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    await delay(200);
  } else {
    await waitForSelector('[data-tour="nav-equipment"], [data-tour="nav-scan"]');
    if ((includeLists && step >= 20) || (!includeLists && step >= 13)) {
      await waitForSelector('[data-tour="dash-cards"]');
    }
  }
}

export type StartTourOptions = TourCallbacks & {
  startAt?: number;
};

export async function startProductTour(cb: StartTourOptions = {}): Promise<void> {
  if (startingTour) return;
  startingTour = true;

  try {
    const startAt = Math.max(0, cb.startAt ?? 0);
    const includeLists = !!cb.includeLists;

    bindProductTourCallbacks(cb);
    liveCb.includeLists = includeLists;

    if (isProductTourActive()) {
      const idx = activeDriver?.getActiveIndex();
      if (idx === startAt) {
        activeDriver?.refresh();
        return;
      }
      destroyDriverSoft();
    }

    const { driver } = await import("driver.js");
    await import("driver.js/dist/driver.css");

    liveCb.onExpandSidebar?.();

    const targetPath = pathForTourStep(startAt, includeLists);
    const current = window.location.pathname.replace(/\/$/, "") || "/";
    if (normalizeTourPath(current) !== targetPath) {
      saveStep(startAt);
      sessionStorage.setItem(RUNNING_KEY, "1");
      sessionStorage.setItem(RESUME_KEY, "1");
      await liveCb.navigateTo?.(targetPath);
      return;
    }

    await prepareStepUi(startAt, includeLists);

    const steps = buildSteps(includeLists);
    const safeStart = Math.min(startAt, Math.max(0, steps.length - 1));

    const teardownUi = () => {
      closeAllTourDialogs();
      liveCb.onRestoreSidebar?.();
    };

    const complete = async () => {
      suppressPauseOnDestroy = true;
      sessionStorage.removeItem(STEP_KEY);
      sessionStorage.removeItem(RUNNING_KEY);
      sessionStorage.removeItem(PAUSED_KEY);
      sessionStorage.removeItem(RESUME_KEY);
      try {
        await completeProductTour(false);
      } catch {
        // Non-blocking
      }
      activeDriver = null;
      teardownUi();
      liveCb.onFinished?.();
    };

    const pause = () => {
      const idx = activeDriver?.getActiveIndex();
      if (typeof idx === "number") saveStep(idx);
      sessionStorage.removeItem(RUNNING_KEY);
      sessionStorage.setItem(PAUSED_KEY, "1");
      activeDriver = null;
      teardownUi();
      liveCb.onPaused?.();
    };

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: false,
      allowKeyboardControl: true,
      overlayClickBehavior: () => {},
      showButtons: ["next", "previous"],
      overlayOpacity: 0.55,
      stagePadding: 8,
      stageRadius: 10,
      skipMissingElement: true,
      disableActiveInteraction: true,
      popoverClass: "tg-driver-popover",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Finish",
      onHighlighted: (_el, _step, { index }) => {
        if (typeof index === "number") saveStep(index);
      },
      onPopoverRender: (popover) => {
        if (popover.closeButton) {
          popover.closeButton.style.display = "none";
        }
        if (popover.wrapper.querySelector("[data-tg-skip]")) return;
        const skip = document.createElement("button");
        skip.type = "button";
        skip.dataset.tgSkip = "1";
        skip.textContent = "Skip for now";
        skip.className = "tg-driver-skip";
        skip.title = "Pause the tour — resume anytime from the top bar";
        skip.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          pause();
          suppressPauseOnDestroy = true;
          d.destroy();
        });
        // Own row above progress + Back/Next — avoids colliding with “n of m”
        popover.footer.parentElement?.insertBefore(skip, popover.footer);
      },
      onDestroyed: () => {
        activeDriver = null;
        closeAllTourDialogs();
        if (suppressPauseOnDestroy) {
          suppressPauseOnDestroy = false;
          return;
        }
        pause();
      },
      onDoneClick: (_el, _step, { driver: drv }) => {
        void complete().finally(() => {
          suppressPauseOnDestroy = true;
          drv.destroy();
        });
      },
      steps: steps as never,
    });

    activeDriver = d;
    sessionStorage.setItem(RUNNING_KEY, "1");
    sessionStorage.removeItem(PAUSED_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    saveStep(safeStart);
    d.drive(safeStart);
  } finally {
    startingTour = false;
  }
}
