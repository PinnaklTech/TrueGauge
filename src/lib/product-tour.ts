import { completeProductTour } from "@/lib/api";

export type TourRoute = "dashboard" | "equipment" | "calibrations" | "certificates";

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
 * 0 welcome, 1 sidebar, 2 equipment nav,
 * 3 lists btn → 4 lists dialog,
 * 5 add-equipment btn → 6 add form,
 * 7 calibrations nav → 8 cal tabs → 9 log form → 10 cal schedules,
 * 11 certificates nav → 12 certificate upload,
 * 13 dash cards, 14 account
 *
 * Member tour:
 * 0 welcome, 1 sidebar, 2 equipment nav, 3 cal nav,
 * 4 cal tabs, 5 cal schedules,
 * 6 certificates nav → 7 certificate vault,
 * 8 dash cards, 9 account
 */
export function pathForTourStep(step: number, includeLists: boolean): TourRoute {
  if (includeLists) {
    if (step >= 3 && step <= 7) return "equipment";
    if (step >= 8 && step <= 11) return "calibrations";
    if (step === 12) return "certificates";
    return "dashboard";
  }
  if (step >= 4 && step <= 6) return "calibrations";
  if (step === 7) return "certificates";
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
  return "dashboard";
}

/**
 * Back navigation — never opens dialogs or visits Equipment/Calibrations pages.
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
    if (fromStep === 6) target = 5; // form → Add Equipment button
    else if (fromStep === 5) target = 3; // add btn → Lists button (skip lists dialog)
    else if (fromStep === 4) target = 3; // lists dialog → Lists button
    else if (fromStep === 7) target = 5; // cal nav → Add Equipment button (no form)
    // Leaving calibrations / certificates / dashboard: skip heavy pages
    else if (fromStep >= 8 && fromStep <= 13) target = 2;
  } else {
    // Member: leaving cal / certificates / dash → dashboard nav
    if (fromStep >= 4 && fromStep <= 8) target = 2;
  }

  const targetPath = pathForTourStep(target, includeLists);
  const current = normalizeTourPath(window.location.pathname);

  // Never navigate into equipment/calibrations/certificates while going back
  if (
    targetPath === "equipment" ||
    targetPath === "calibrations" ||
    targetPath === "certificates"
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
        title: "Welcome to TrueGage",
        description:
          "A quick tour of your workspace. Skip for now pauses — you can resume anytime from the top bar.",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-sidebar"]',
      popover: {
        title: "Navigation",
        description: "Move between Dashboard, Equipment, Calibrations, Certificates, and more from this sidebar.",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="nav-equipment"]',
      popover: {
        title: "Equipment",
        description: includeLists
          ? "Your gauge register lives here. Next we’ll peek at Lists and adding equipment."
          : "Browse gauges and instruments, check due dates, and open a record for full history.",
        side: "right",
        align: "start",
        onNextClick: includeLists
          ? async () => {
              await handoffToStep(3, "equipment");
            }
          : undefined,
      },
    },
  ];

  if (includeLists) {
    steps.push(
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
            await backLight(3, true, drv);
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
            await backLight(4, true, drv);
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
            await backLight(5, true, drv);
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
            await backLight(6, true, drv);
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
            await handoffToStep(8, "calibrations");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(7, true, drv);
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
            await backLight(8, true, drv);
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
            await backLight(9, true, drv);
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
            await backLight(10, true, drv);
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
            await handoffToStep(12, "certificates");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(11, true, drv);
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
          onNextClick: async () => {
            await handoffToStep(13, "dashboard");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(12, true, drv);
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
            await handoffToStep(4, "calibrations");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(3, false, drv);
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
            await backLight(4, false, drv);
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
            await backLight(5, false, drv);
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
            await handoffToStep(7, "certificates");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(6, false, drv);
          },
        },
      },
      {
        element: '[data-tour="certificates-vault"], [data-tour="certificates-intro"]',
        popover: {
          title: "Certificate vault",
          description:
            "Search and open certificates here. Preview, download, and review which gauge each PDF is linked to.",
          side: "bottom",
          align: "center",
          onNextClick: async () => {
            await handoffToStep(8, "dashboard");
          },
          onPrevClick: async (_el, _step, { driver: drv }) => {
            await backLight(7, false, drv);
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
          await backLight(includeLists ? 13 : 8, includeLists, drv);
        },
      },
    },
    {
      element: '[data-tour="account-menu"]',
      popover: {
        title: "Your account",
        description: "Open Profile anytime for preferences. Click Finish when you’re done.",
        side: "right",
        align: "end",
        onPrevClick: async (_el, _step, { driver: drv }) => {
          await backLight(includeLists ? 14 : 9, includeLists, drv);
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
    await waitForSelector('[data-tour="equipment-lists"], [data-tour="equipment-add"]');
    closeAllTourDialogs();
    if (includeLists && step === 4) {
      openListsDialog();
      await waitForSelector('[data-tour="equipment-lists-dialog"]');
      await delay(280);
    } else if (includeLists && step === 6) {
      openEquipmentCreate();
      await waitForSelector('[data-tour="equipment-create-dialog"]');
      await delay(280);
    }
  } else if (path === "calibrations") {
    window.dispatchEvent(new Event("tg-tour-open-calibrations"));
    await waitForSelector('[data-tour="cal-tabs"]');
    await waitForSelector('[data-tour="cal-schedules"], [data-tour="cal-log-form"]');
    if (includeLists && step === 9) {
      window.dispatchEvent(new Event("tg-tour-open-cal-log"));
      await waitForSelector('[data-tour="cal-log-form"]');
      await delay(280);
      document
        .querySelector('[data-tour="cal-log-form"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      await delay(200);
    } else if ((includeLists && step === 11) || (!includeLists && step === 6)) {
      window.dispatchEvent(new Event("tg-tour-close-cal-log"));
      await waitForSelector('[data-tour="nav-certificates"]');
      await delay(120);
    } else {
      window.dispatchEvent(new Event("tg-tour-close-cal-log"));
      if (includeLists && step === 10) {
        await waitForSelector('[data-tour="cal-schedules"]');
      }
    }
  } else if (path === "certificates") {
    // Prefer the upload card so the highlight anchors mid-page (not the tall vault wrapper)
    const upload = await waitForSelector('[data-tour="certificates-upload"]', 100);
    if (!upload) {
      await waitForSelector(
        '[data-tour="certificates-vault"], [data-tour="certificates-intro"]',
      );
    }
    await delay(200);
    const target =
      document.querySelector('[data-tour="certificates-upload"]') ??
      document.querySelector('[data-tour="certificates-vault"]');
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(320);
  } else {
    await waitForSelector('[data-tour="nav-equipment"]');
    if ((includeLists && step >= 13) || (!includeLists && step >= 8)) {
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
    const normalize = (p: string): TourRoute => {
      if (p.includes("/equipment")) return "equipment";
      if (p.includes("/calibrations")) return "calibrations";
      if (p.includes("/certificates")) return "certificates";
      return "dashboard";
    };
    if (normalize(current) !== targetPath) {
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
