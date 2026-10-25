// ApplyPilot job detector. Injected on demand (chrome.scripting) into the active tab's top frame.
// Order: JSON-LD JobPosting → site adapters (LinkedIn, Naukri, Internshala, Indeed, Greenhouse, Lever, Workday) → generic heuristic.
// Returns a plain object (the value of the last expression is the injection result). Read-only: never changes the page.
(() => {
  const clean = (t, max = 300) => (t || "").replace(/\s+/g, " ").trim().slice(0, max);
  const text = (el, max = 12000) => (el ? (el.innerText || el.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max) : "");
  const q = (sel) => { for (const s of sel.split("||")) { try { const el = document.querySelector(s.trim()); if (el && text(el, 50)) return el; } catch (_) { /* bad selector */ } } return null; };
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") || "";
  // Parse HTML from JSON-LD into text without executing anything (DOMParser documents are inert).
  const parseText = (html) => text(new DOMParser().parseFromString(String(html || ""), "text/html").body);
  const htmlToText = (html) => {
    try { let t = parseText(html); if (/<\/?[a-z][^>]*>/i.test(t)) t = parseText(t); return t; } // some sites double-encode their HTML
    catch (_) { return clean(String(html || "").replace(/<[^>]+>/g, " "), 12000); }
  };

  function fromJsonLd() {
    const nodes = [];
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      const t = o["@type"]; if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) nodes.push(o);
      if (o["@graph"]) walk(o["@graph"]);
    };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { walk(JSON.parse(s.textContent || "")); } catch (_) { /* ignore */ } });
    const j = nodes[0]; if (!j) return null;
    const locs = [].concat(j.jobLocation || []).map((l) => { const a = l && l.address || {}; return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(", "); }).filter(Boolean);
    const org = j.hiringOrganization; const company = typeof org === "string" ? org : org && org.name;
    let salary = "";
    const bs = j.baseSalary && j.baseSalary.value;
    if (bs && (bs.minValue || bs.value)) salary = `${j.baseSalary.currency || ""} ${bs.minValue || bs.value}${bs.maxValue ? "–" + bs.maxValue : ""} ${bs.unitText || ""}`.trim();
    return {
      title: clean(j.title), company: clean(company), location: clean(locs.join(" / ")),
      remote: j.jobLocationType === "TELECOMMUTE" || /remote/i.test(locs.join(" ")),
      description: htmlToText(j.description), posted_at: j.datePosted || null, salary: clean(salary, 80), source: "json-ld"
    };
  }

  const ADAPTERS = [
    { name: "linkedin", host: /(^|\.)linkedin\.com$/, path: /\/jobs\//,
      title: ".job-details-jobs-unified-top-card__job-title || .jobs-unified-top-card__job-title || .top-card-layout__title || h1",
      company: ".job-details-jobs-unified-top-card__company-name || .jobs-unified-top-card__company-name || .topcard__org-name-link || .topcard__flavor",
      location: ".job-details-jobs-unified-top-card__primary-description-container .tvm__text || .job-details-jobs-unified-top-card__bullet || .topcard__flavor--bullet",
      description: "#job-details || .jobs-description__content || .jobs-description-content__text || .description__text" },
    { name: "naukri", host: /(^|\.)naukri\.com$/,
      title: "[class*='jd-header-title'] || h1",
      company: "[class*='jd-header-comp-name'] a || [class*='jd-header-comp-name']",
      location: "[class*='jhc__location'] || [class*='location']",
      description: "[class*='JDC__dang-inner-html'] || [class*='job-desc'] || section[class*='job-desc']" },
    { name: "internshala", host: /(^|\.)internshala\.com$/,
      title: ".profile_on_detail_page || .heading_4_5.profile || .profile || h1",
      company: ".company_name a || .company-name || .company_name",
      location: "#location_names a || .location_link || #location_names",
      description: ".internship_details || .detail_view .text-container || .about_company_text_container" },
    { name: "indeed", host: /(^|\.)indeed\.(com|co\.in)$/,
      title: "[data-testid='jobsearch-JobInfoHeader-title'] || h1.jobsearch-JobInfoHeader-title || h1",
      company: "[data-testid='inlineHeader-companyName'] || [data-company-name='true'] || .jobsearch-CompanyInfoContainer a",
      location: "[data-testid='inlineHeader-companyLocation'] || [data-testid='job-location'] || .jobsearch-JobInfoHeader-subtitle div:last-child",
      description: "#jobDescriptionText" },
    { name: "greenhouse", host: /(^|\.)greenhouse\.io$/,
      title: ".job__title h1 || h1.app-title || .app-title || h1",
      company: ".company-name || .job__header .logo img[alt] || header img[alt]",
      location: ".job__location || .location",
      description: ".job__description || #content || #app_body" },
    { name: "lever", host: /(^|\.)lever\.co$/,
      title: ".posting-headline h2 || h2",
      company: ".main-header-logo img[alt] || .main-header-text",
      location: ".posting-categories .location || .posting-categories .sort-by-time",
      description: "[data-qa='job-description'] || .posting-page .section-wrapper || .content" },
    { name: "workday", host: /(myworkdayjobs|myworkdaysite|workday)\.com$/,
      title: "[data-automation-id='jobPostingHeader'] || h2 || h1",
      company: "[data-automation-id='company'] || [data-automation-id='jobPostingCompany']",
      location: "[data-automation-id='locations'] dd || [data-automation-id='locations']",
      description: "[data-automation-id='jobPostingDescription']" }
  ];

  function fromAdapter() {
    const host = location.hostname.toLowerCase();
    const a = ADAPTERS.find((x) => x.host.test(host) && (!x.path || x.path.test(location.pathname)));
    if (!a) return null;
    const el = (sel) => q(sel);
    const companyEl = el(a.company);
    const company = companyEl ? (companyEl.tagName === "IMG" ? companyEl.getAttribute("alt") : text(companyEl, 160)) : "";
    let fallbackCompany = meta("og:site_name");
    if (a.name === "workday") fallbackCompany = fallbackCompany || host.split(".")[0];
    if (a.name === "lever" || a.name === "greenhouse") fallbackCompany = fallbackCompany || (location.pathname.split("/")[1] || "");
    const description = text(el(a.description));
    const title = clean(text(el(a.title), 300));
    if (!title && !description) return null;
    const loc = clean(text(el(a.location), 160));
    return { title, company: clean(company || fallbackCompany, 160), location: loc, remote: /remote|work from home|wfh/i.test(`${loc} ${title}`), description, posted_at: null, salary: "", source: a.name };
  }

  function generic() {
    const KW = /(responsibilities|requirements|qualifications|what you('|’)ll do|about the role|job description|skills required|eligibility|who you are|key skills)/i;
    let best = null, bestScore = 0;
    document.querySelectorAll("main, article, section, div").forEach((el) => {
      if (el.closest("nav, header, footer, aside, form")) return;
      const t = el.innerText || ""; const len = t.length;
      if (len < 400 || len > 25000) return;
      const hits = (t.match(new RegExp(KW.source, "gi")) || []).length;
      if (!hits) return;
      const score = hits * 1000 + Math.min(len, 8000) - (el.querySelectorAll("a").length * 40);
      if (score > bestScore) { best = el; bestScore = score; }
    });
    const h1 = document.querySelector("h1");
    const title = clean(text(h1, 200) || meta("og:title") || document.title, 200);
    if (!best) return { title, company: clean(meta("og:site_name"), 160), location: "", remote: false, description: "", posted_at: null, salary: "", source: "generic", weak: true };
    return { title, company: clean(meta("og:site_name"), 160), location: "", remote: /\bremote\b/i.test(text(best, 3000)), description: text(best), posted_at: null, salary: "", source: "generic" };
  }

  let job = null;
  try { job = fromJsonLd(); } catch (_) { job = null; }
  if (!job || !job.title) { try { job = fromAdapter() || job; } catch (_) { /* ignore */ } }
  else if (!job.description) { try { const a = fromAdapter(); if (a) job.description = a.description; } catch (_) { /* ignore */ } }
  if (!job || !job.title) { try { job = generic(); } catch (_) { job = null; } }

  const hasForm = !!document.querySelector("form input:not([type=hidden]), form textarea, form select");
  if (!job) return { found: false, url: location.href, pageTitle: document.title, hasForm };
  const found = !job.weak && !!job.title && (job.source !== "generic" || job.description.length > 300);
  return { found, confidence: job.source === "json-ld" ? "high" : job.source === "generic" ? "low" : "medium", ...job, url: location.href, pageTitle: clean(document.title, 200), hasForm };
})();
