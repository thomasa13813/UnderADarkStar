// Type-only: a value import would register <game-mode-selector> wherever
// Navigation is imported, and the element boots a lobby socket on connect.
import type { GameModeSelector } from "./GameModeSelector";

// Pages a click outside the panel does not close (see initNavigation).
const BACK_ARROW_ONLY_PAGES = new Set([
  "page-single-player",
  "page-host-lobby",
  "page-join-lobby",
]);

export function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar-menu");
  const backdrop = document.getElementById("mobile-menu-backdrop");
  if (sidebar?.classList.contains("open")) {
    sidebar.classList.remove("open");
    backdrop?.classList.remove("open");
    document.documentElement.classList.remove("overflow-hidden");
    sidebar.setAttribute("aria-hidden", "true");
    backdrop?.setAttribute("aria-hidden", "true");
    const hb = document.getElementById("hamburger-btn");
    if (hb) hb.setAttribute("aria-expanded", "false");
  }
}

export function initNavigation() {
  const showPage = (pageId: string) => {
    window.currentPageId = pageId;

    // Close mobile sidebar if a nav item was clicked
    closeMobileSidebar();

    // Close the currently visible modal properly
    const visibleModal = document.querySelector(".page-content:not(.hidden)");
    if (visibleModal) {
      // If it's an open modal component, call close() for proper cleanup (onClose callback, etc.)
      if (
        typeof (visibleModal as any).isOpen === "function" &&
        (visibleModal as any).isOpen() &&
        typeof (visibleModal as any).close === "function"
      ) {
        (visibleModal as any).close();
      } else {
        visibleModal.classList.add("hidden");
        visibleModal.classList.remove("block");
      }
    }

    // Inline pages scroll inside their modal, not the document (see
    // styles.css). Set after closing the previous modal: an inline modal's
    // close() re-enters showPage("page-play"), which would clear this.
    document.body.classList.toggle("page-open", pageId !== "page-play");

    // Handle page-play separately (it's not a page-content element)
    const pagePlayEl = document.getElementById("page-play");
    if (pageId === "page-play") {
      pagePlayEl?.classList.remove("hidden");
    } else {
      pagePlayEl?.classList.add("hidden");
    }

    // Show the target page if it's a modal
    if (pageId !== "page-play") {
      const target = document.getElementById(pageId);
      if (target) {
        target.classList.remove("hidden");
        // Modals need block display explicitly
        if (target.classList.contains("page-content")) {
          target.classList.add("block");
        }

        // If the target itself is a modal component with inline attribute, open it
        if (
          target.hasAttribute("inline") &&
          typeof (target as any).open === "function"
        ) {
          (target as any).open();
        }
      }
    }

    // Update active state on menu items
    document.querySelectorAll(".nav-menu-item").forEach((item) => {
      if ((item as HTMLElement).dataset.page === pageId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // Dispatch CustomEvent to notify listeners of page change
    window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
  };

  window.showPage = showPage;

  // Use event delegation for navigation items (they may be inside Lit components)
  document.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest(
      ".nav-menu-item[data-page]",
    );
    if (target) {
      const pageId = (target as HTMLElement).dataset.page;
      if (!pageId) return;

      // showPage() closes the currently visible modal, so respect its
      // close-confirmation guard first (e.g. the leave-lobby prompt).
      const visibleModal = document.querySelector(
        ".page-content:not(.hidden)",
      ) as any;
      if (
        visibleModal &&
        typeof visibleModal.isOpen === "function" &&
        visibleModal.isOpen() &&
        typeof visibleModal.confirmBeforeClose === "function" &&
        !(await visibleModal.confirmBeforeClose())
      ) {
        return;
      }

      showPage(pageId);

      // The nav bar's Play item (data-join-hero) is a second way into the
      // top game: once home, with any open page closed above, hop into the
      // throne the hero card shows. After showPage, not before: the join
      // opens the lobby page, which showPage("page-play") would close.
      if (pageId === "page-play" && target.hasAttribute("data-join-hero")) {
        const selector = document.querySelector(
          "game-mode-selector",
        ) as GameModeSelector | null;
        selector?.joinHeroLobby();
      }
    }
  });

  // Wait for main-layout component to render before setting up click handler
  customElements.whenDefined("main-layout").then(() => {
    // Handle clicks on main container to close open modals (navigate back)
    const mainEl = document.querySelector("main");

    if (mainEl) {
      mainEl.addEventListener("click", async (e: Event) => {
        const target = e.target as HTMLElement;
        const isPlayPageHidden = document
          .getElementById("page-play")
          ?.classList.contains("hidden");

        // Only proceed if we are NOT on the play page (meaning a modal page is open)
        if (isPlayPageHidden) {
          // Close modal if clicking on main element itself, or directly on a page-content element
          const isOnMain = target === mainEl;
          const isOnPageContent = target.classList.contains("page-content");

          if (isOnMain || isOnPageContent) {
            // Find the open modal and call its close() method instead of showPage directly
            // This ensures proper cleanup (like websocket disconnection)
            const openModal = document.querySelector(
              ".page-content:not(.hidden)",
            ) as any;

            // The game setup pages leave only by their back arrow: a stray
            // click beside the panel threw playtesters back to the main menu.
            if (openModal && BACK_ARROW_ONLY_PAGES.has(openModal.id)) return;

            if (openModal && typeof openModal.close === "function") {
              // Check confirmation guard before closing
              if (
                typeof openModal.confirmBeforeClose === "function" &&
                !(await openModal.confirmBeforeClose())
              ) {
                return;
              }
              // Call leaveLobby or closeAndLeave first if it exists (for lobby modals)
              if (typeof openModal.leaveLobby === "function") {
                openModal.leaveLobby();
              } else if (typeof openModal.closeAndLeave === "function") {
                openModal.closeAndLeave();
                return; // closeAndLeave already calls close()
              }
              openModal.close();
            } else {
              showPage("page-play");
            }
          }
        }
      });
    }
  });

  // Ensure Play is the default visible/active page on load.
  showPage("page-play");
}
