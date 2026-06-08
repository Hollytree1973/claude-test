// ===== HLG Veterinary Physiotherapy — interactions =====
(function () {
  "use strict";

  // Mobile nav toggle
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    // Close the menu after tapping a link
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      });
    });
  }

  // Current year in footer
  var yearEl = document.getElementById("year");
  if (yearEl) { yearEl.textContent = new Date().getFullYear(); }

  // Scroll reveal — tag the main content blocks
  var revealTargets = document.querySelectorAll(
    ".section-head, .card, .price-card, .included-col, .reward-card, .travel-card, .about-card, .about-copy, .hero-copy, .contact-form, .contact-copy"
  );
  revealTargets.forEach(function (el) { el.classList.add("reveal"); });

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add("is-visible"); });
  }
})();
