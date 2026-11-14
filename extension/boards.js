// ApplyPilot Board Auto-Apply: one config object per supported job board (v2.9: + Shine, Hirist, Instahyre, Cutshort, Wellfound).
// Loaded in BOTH the service worker (importScripts) and the page (chrome.scripting files), so keep it plain data plus
// tiny pure functions. Boards change their markup often: every selector list is tried in order, and every list has a
// text-based fallback ("Apply", "Easily apply", "Applied"), so one stale selector never breaks a board on its own.
//
// Grounding (2026-10-26, see the extension report):
//   internshala: listing card / title / company / pagination selectors taken from live public HTML; the
//                matching-preferences URLs exist (logged-out they redirect). Application-form selectors are best-effort.
//   naukri:      /mnjuser/recommendedjobs confirmed (redirects to login when logged out). Tuple classes
//                (.srp-jobtuple-wrapper, .cust-job-tuple, .reco-tuple, .title, .comp-name) confirmed in Naukri's live CSS.
//                Recommended-page tabs, job-page buttons and the apply chatbot are best-effort (pages are client-rendered).
//   indeed:      in.indeed.com returns 403 to non-browser clients: everything is best-effort.
//   foundit:     /rio/recommended-jobs redirects to /rio/login (route exists behind login); markup is best-effort. Off by default.
// LinkedIn is never listed here and the runner refuses any linkedin.com URL.
"use strict";
(function (g) {
  const APPLIED_EXACT = /^(already applied|applied|you applied|applied on .{1,30}|application sent|applied \d+ \w+ ago)$/i;
  const COMMON_RATE = /too many (applications|requests|attempts)|(daily|application|apply) limit (reached|exceeded)|you have reached (the|your) (maximum|daily|limit)|exceeded (the|your) (daily )?limit|please try again (later|after)|unusual (activity|traffic)|are you a robot|verify (that )?you are (a )?human|access denied|temporarily blocked|request (has been )?blocked/i;
  const slug = (r) => encodeURIComponent(String(r || "").toLowerCase().trim().replace(/[^a-z0-9+#]+/g, "-").replace(/^-+|-+$/g, ""));
  const COMMON_SUCCESS = /(you have successfully applied|successfully applied|applied successfully|application (has been |was )?(successfully )?(submitted|sent|received)|your application has been (successfully )?(submitted|sent)|you('|’)ve applied|you have applied|thank(s| you) for applying)/i;

  const BOARDS = {
    naukri: {
      id: "naukri", name: "Naukri", defaultCap: 25, defaultOn: true,
      hosts: /(^|\.)naukri\.com$/i,
      recommended: ["https://www.naukri.com/mnjuser/recommendedjobs"],
      loginUrl: /\/(nlogin|login|registration)\b/i,
      listing: {
        card: ["article.jobTuple", ".jobTuple", "[class*='reco-tuple']", ".cust-job-tuple", ".srp-jobtuple-wrapper", "[data-job-id]", "[class*='jobTupleWrapper']"],
        link: ["a.title", "a[class*='title']", "a[href*='/job-listings-']"],
        linkPattern: /\/job-listings-/i,
        title: ["a.title", "[class*='title']"],
        company: [".comp-name", "[class*='comp-name']", "[class*='companyInfo'] a", "[class*='subTitle']"],
        // Tabs on the recommended page (Profile / Applies / Preferences / You might like / Top candidate).
        tabs: /^(profile|applies|preferences|you might like|top candidate|similar jobs)(\s*\(\d+\))?$/i,
        next: ["a[class*='styles_btn-secondary'] ~ a", "a.fright.fs14.btn-secondary.br2"],
        nextText: /^next$/i,
        require: null
      },
      job: {
        title: ["[class*='jd-header-title']", "h1"],
        company: ["[class*='jd-header-comp-name'] a", "[class*='jd-header-comp-name']"],
        description: ["[class*='JDC__dang-inner-html']", "[class*='job-desc']", "section[class*='job-desc']", "main"],
        applied: ["#already-applied", "[class*='already-applied']"],
        applySel: ["#apply-button", "button[class*='apply-button']", "[class*='styles_jhc__apply-button']"],
        applyText: /^(apply|apply now|i am interested)$/i,
        externalSel: ["#company-site-button", "[class*='company-site-button']"],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)naukri\.com$/i,
        containers: ["[class*='chatbot_Drawer']", "[class*='chatbot_DrawerContentWrapper']", "[class*='apply-drawer']", "[role='dialog']"],
        chat: {
          drawer: ["[class*='chatbot_DrawerContentWrapper']", "[class*='chatbot_Drawer']", "[class*='chatbot']"],
          botMsg: ["[class*='botMsg']", "li[class*='botItem']", "[class*='chatbot_ListItem'] [class*='bot']", "[class*='msg'][class*='bot']"],
          chips: ["[class*='chatbot_Chip']", "[class*='chipItem']", "[class*='ssrc__radio-btn-container'] label", "[class*='ssrc__'] label", "[class*='mcc__'] label"],
          input: ["[class*='chatbot_InputContainer'] [contenteditable='true']", "div.textArea[contenteditable='true']", "[class*='chatbot'] [contenteditable='true']", "[class*='chatbot'] input[type='text']", "[class*='chatbot'] textarea"],
          send: ["[class*='sendMsg']", "[class*='chatbot_SendMessageContainer'] *", "[class*='send']"],
          sendText: /^(save|send|submit|done|next)$/i
        },
        nextText: /^(next|continue|save and continue|proceed)$/i,
        submitText: /^(submit|apply|send application|confirm)$/i,
        errorSel: ["[class*='error']:not([class*='errorBoundary'])"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    internshala: {
      id: "internshala", name: "Internshala", defaultCap: 25, defaultOn: true,
      hosts: /(^|\.)internshala\.com$/i,
      recommended: ["https://internshala.com/internships/matching-preferences/", "https://internshala.com/jobs/matching-preferences/"],
      loginUrl: /\/(login|registration|register)\b/i,
      listing: {
        card: [".individual_internship[internshipid]", ".individual_internship[data-href]", ".individual_internship"],
        link: ["a.job-title-href", "h2.job-internship-name a", ".job-internship-name a", "a[href*='/internship/detail/']", "a[href*='/job/detail/']"],
        linkPattern: /\/(internship|job)\/detail\//i,
        urlAttr: "data-href",
        title: [".job-internship-name", "a.job-title-href", ".profile"],
        company: [".company-name", ".company_name", ".heading_6.company_name"],
        tabs: null,
        next: ["#navigation-forward", "a.next_page"],
        nextText: /^next$/i,
        lastPage: "#isLastPage",
        require: null
      },
      job: {
        title: [".profile_on_detail_page", ".heading_4_5.profile", ".job-internship-name", "h1"],
        company: [".company_name a", ".company-name", ".company_name"],
        description: [".internship_details", ".detail_view .text-container", ".about_company_text_container", "#details_container"],
        applied: [".applied_status", "[class*='already_applied']", "#already_applied"],
        applySel: ["#easy_apply_button", ".apply_now_btn", "#apply_now_button", "button[class*='apply_now']", "a.apply_now_button button"],
        applyText: /^(apply now|apply|easy apply)$/i,
        externalSel: [],
        externalText: /apply on (company|external) (site|website)/i
      },
      apply: {
        hosts: /(^|\.)internshala\.com$/i,
        containers: ["#application-form-container", "form#application_form", "#application_form", ".application_form", "#easy_apply_modal .modal-content", ".modal.easy-apply .modal-content", ".modal.show .modal-content"],
        chat: null,
        nextText: /^(proceed|proceed to application|continue|next|apply)$/i,
        submitText: /^(submit|submit application|submit your application)$/i,
        errorSel: [".error:not(:empty)", ".form-error", ".has-error .help-block"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    indeed: {
      id: "indeed", name: "Indeed India", defaultCap: 15, defaultOn: true,
      hosts: /^(in\.indeed\.com|smartapply\.indeed\.com|apply\.indeed\.com|m5\.apply\.indeed\.com)$/i,
      recommended: ["https://in.indeed.com/"],
      loginUrl: /(secure\.indeed\.com|\/account\/login|\/auth\b)/i,
      listing: {
        card: ["[data-testid='slider_item']", ".job_seen_beacon", ".cardOutline", "li div[data-jk]", "[data-jk]"],
        link: ["a.jcs-JobTitle", "h2.jobTitle a", "a[data-jk]", "a[href*='viewjob']", "a[href*='/rc/clk']"],
        linkPattern: /(viewjob|\/rc\/clk|\/pagead\/clk)/i,
        jkAttr: "data-jk",
        jobUrl: (jk) => `https://in.indeed.com/viewjob?jk=${encodeURIComponent(jk)}`,
        title: ["h2.jobTitle", "a.jcs-JobTitle", "[class*='jobTitle']"],
        company: ["[data-testid='company-name']", ".companyName", "[class*='companyName']"],
        tabs: null,
        next: ["[data-testid='pagination-page-next']", "a[aria-label='Next Page']"],
        nextText: /^next$/i,
        // Only "Easily apply" (Indeed Apply) cards are eligible.
        require: /easily apply|indeed apply/i,
        requireSel: ["[data-testid='indeedApply']", ".iaLabel", ".ialbl"]
      },
      job: {
        title: ["[data-testid='jobsearch-JobInfoHeader-title']", "h1.jobsearch-JobInfoHeader-title", "h1"],
        company: ["[data-testid='inlineHeader-companyName']", "[data-company-name='true']"],
        description: ["#jobDescriptionText"],
        applied: ["[data-testid='applied-label']", ".jobsearch-AppliedBadge"],
        applySel: ["#indeedApplyButton", "button[id*='indeedApplyButton']", "[data-testid*='indeedApply'] button", "button[data-testid*='indeedApply']", "#jobsearch-ViewJobButtons-container button", ".jobsearch-IndeedApplyButton-newDesign", "[class*='IndeedApplyButton'] button", ".ia-IndeedApplyButton"],
        applyText: /^(apply now|easily apply)$/i,
        applyRequiresSel: ["#indeedApplyButton", "[id*='indeedApply']", "[data-testid*='indeedApply']", "[class*='IndeedApply']", ".ia-IndeedApplyButton", "[data-indeed-apply-jobid]"],
        externalSel: ["#applyButtonLinkContainer a", "[data-testid='applyButton-externalLink']"],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /^(in\.indeed\.com|smartapply\.indeed\.com|apply\.indeed\.com|m5\.apply\.indeed\.com)$/i,
        containers: ["#ia-container", "[class*='ia-BasePage']", "main", "form"],
        chat: null,
        nextText: /^(continue|next|continue to review|review your application|review)$/i,
        submitText: /^(submit your application|submit application|submit)$/i,
        errorSel: ["[class*='error'][role='alert']", "[id*='errorText']", "[class*='ia-ErrorText']"],
        success: /(your application has been submitted|application submitted|you('|’)ve applied|you have applied|thank(s| you) for applying)/i
      },
      rate: COMMON_RATE
    },

    // v2.9: more Indian/startup boards. Grounded 2026-11-09 on public pages: Shine (result-card_* cards, /jobs/<role>/<co>/<id>,
    // job page role-overview-card_applyBtn "Apply Now"), Hirist (/j/<slug>-<id>, /k/<skill>-jobs search), Instahyre (/job-<id>-<slug>,
    // /<skill>-jobs/ search, "Apply now"), Cutshort (/job/<slug>-<id>, "Apply to this job"), Wellfound (/jobs/<id>-<slug>, /role/<role>,
    // "Apply"). Logged-in feeds and the apply dialogs are client-rendered, so those parts are best-effort with text fallbacks.
    // Every new board also has search(role): when its recommended feed gives nothing, the runner searches your roles there.
    shine: {
      id: "shine", bestEffort: true, name: "Shine", defaultCap: 10, defaultOn: true,
      hosts: /(^|\.)shine\.com$/i,
      recommended: ["https://www.shine.com/myshine/mydashboard/"],
      search: (r) => `https://www.shine.com/job-search/${slug(r)}-jobs`,
      loginUrl: /\/myshine\/login|\/(login|registration)\b/i,
      listing: {
        card: ["article[class*='result-card_card']:not([class*='placeholder'])", "[class*='jobCard']", "[class*='JobCard']"],
        link: ["a[class*='result-card_hit']", "h3 a[href*='/jobs/']", "a[href*='/jobs/']"],
        linkPattern: /\/jobs\/[^/?#]+\/[^/?#]+\/\d+/i,
        title: ["[class*='result-card_role']", "h3", "h2"],
        company: ["[class*='result-card_company']", "[class*='result-card_co']", "[class*='company']"],
        tabs: null,
        next: ["a[rel='next']", "[class*='pagination'] a[aria-label*='Next']"],
        nextText: /^next$/i,
        require: null
      },
      job: {
        title: ["[class*='role-overview-card_title']", "h1"],
        company: ["[class*='role-overview-card_companyName']", "[class*='companyName']"],
        description: ["[class*='collapsible-jd-body_body']", "[class*='job-description-page_section']", "[class*='jobDescription']", "main"],
        applied: ["[class*='appliedBtn']", "[class*='applied_btn']"],
        applySel: ["[class*='role-overview-card_applyBtn']", "button[data-apply-trigger]"],
        applyText: /^(apply|apply now)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)shine\.com$/i,
        containers: ["[role='dialog']", "[class*='modal']", "[class*='Modal']", "[class*='drawer']", "[class*='Drawer']"],
        chat: null,
        nextText: /^(next|continue|proceed|save and continue|save & continue)$/i,
        submitText: /^(submit|apply|apply now|submit application|confirm|confirm & apply|confirm and apply)$/i,
        errorSel: ["[class*='error']:not(:empty)", "[role='alert']"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    hirist: {
      id: "hirist", bestEffort: true, name: "Hirist", defaultCap: 10, defaultOn: true,
      hosts: /(^|\.)hirist\.(tech|com)$/i,
      recommended: ["https://www.hirist.tech/jobfeed"],
      search: (r) => `https://www.hirist.tech/k/${slug(r)}-jobs`,
      loginUrl: /\/(login|signin|register|signup)\b/i,
      listing: {
        card: ["[class*='job-card']", "[class*='jobCard']", "[class*='JobCard']", "[data-testid*='job-card']"],
        link: ["a[href*='/j/']"],
        linkPattern: /\/j\/[a-z0-9-]+-\d+/i,
        title: ["[class*='job-title']", "[class*='jobTitle']", "h2", "h3", "a[href*='/j/']"],
        company: ["[class*='company-name']", "[class*='companyName']", "[class*='company']"],
        tabs: null,
        next: ["a[rel='next']"],
        nextText: /^(next|load more)$/i,
        require: null
      },
      job: {
        title: ["h1"],
        company: ["[class*='company-name']", "[class*='companyName']", "[class*='recruiter'] a"],
        description: ["[class*='job-description']", "[class*='jobDescription']", "[class*='JobDescription']", "main"],
        applied: [],
        applySel: ["button[class*='apply' i]", "[class*='apply-btn']", "[class*='applyBtn']"],
        applyText: /^(apply|apply now|easy apply)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)hirist\.(tech|com)$/i,
        containers: ["[role='dialog']", "[class*='modal']", "[class*='Modal']", "[class*='drawer']"],
        chat: null,
        nextText: /^(next|continue|proceed|save and continue)$/i,
        submitText: /^(submit|apply|apply now|send application|confirm)$/i,
        errorSel: ["[class*='error']:not(:empty)", "[role='alert']"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    instahyre: {
      id: "instahyre", bestEffort: true, name: "Instahyre", defaultCap: 10, defaultOn: true,
      hosts: /(^|\.)instahyre\.com$/i,
      recommended: ["https://www.instahyre.com/candidate/opportunities/?matching=true"],
      search: (r) => `https://www.instahyre.com/${slug(r)}-jobs/`,
      loginUrl: /\/(login|signup)\b/i,
      listing: {
        card: ["[id^='employer-']", "[class*='employer-row']", "[class*='opportunity-row']", ".employer-block"],
        link: ["a[href*='/job-']"],
        linkPattern: /\/job-\d+-/i,
        title: ["[class*='job-title']", "[class*='candidate_title']", "h2", "h3", "a[href*='/job-']"],
        company: ["[class*='company-name']", "[class*='companyName']", "[class*='company']"],
        tabs: null,
        next: ["a[rel='next']", ".pagination .next a"],
        nextText: /^(next|show more|load more)$/i,
        require: null
      },
      job: {
        title: ["h1"],
        company: ["h2", "[class*='company-name']"],
        description: ["[class*='job-description']", "#job-description", ".job-details", "main"],
        applied: [],
        applySel: ["#apply-button", "button[class*='apply' i]", "[class*='apply-btn']"],
        applyText: /^(apply|apply now|interested|i('|’)m interested)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)instahyre\.com$/i,
        containers: ["[role='dialog']", ".modal.in .modal-content", ".modal.show .modal-content", "[class*='modal']"],
        chat: null,
        nextText: /^(next|continue|proceed)$/i,
        submitText: /^(apply|submit|confirm|send|send application)$/i,
        errorSel: [".error:not(:empty)", "[class*='error']:not(:empty)"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    cutshort: {
      id: "cutshort", bestEffort: true, name: "Cutshort", defaultCap: 10, defaultOn: true,
      hosts: /(^|\.)cutshort\.io$/i,
      recommended: ["https://cutshort.io/jobs/recommended"],
      search: (r) => `https://cutshort.io/jobs/${slug(r)}-jobs`,
      loginUrl: /\/(login|signin|signup)\b/i,
      listing: {
        card: ["[class*='JobCard']", "[class*='job-card']", "[class*='jobCard']"],
        link: ["a[href*='/job/']"],
        linkPattern: /\/job\/[A-Za-z0-9-]+-[A-Za-z0-9]{6,}(\?|$)/,
        title: ["h2 a[href*='/job/']", "h3 a[href*='/job/']", "h2", "h3"],
        company: ["a[href*='/company/']", "[class*='company']"],
        tabs: null,
        next: ["a[rel='next']"],
        nextText: /^(next|load more|show more)$/i,
        require: null
      },
      job: {
        title: ["h1"],
        company: ["a[href*='/company/']"],
        description: ["[class*='description']", "[class*='Description']", "main"],
        applied: [],
        applySel: ["button[label='Apply to this job']"],
        applyText: /^(apply|apply now|apply to this job)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)cutshort\.io$/i,
        containers: ["[role='dialog']", "[class*='modal']", "[class*='Modal']", "[class*='drawer']"],
        chat: null,
        nextText: /^(next|continue|proceed)$/i,
        submitText: /^(apply|apply now|submit|submit application|send application|confirm)$/i,
        errorSel: ["[class*='error']:not(:empty)", "[role='alert']"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    wellfound: {
      id: "wellfound", bestEffort: true, name: "Wellfound", defaultCap: 10, defaultOn: true,
      hosts: /(^|\.)wellfound\.com$/i,
      recommended: ["https://wellfound.com/jobs"],
      search: (r) => `https://wellfound.com/role/${slug(r)}`,
      loginUrl: /\/(login|signup|join)\b/i,
      listing: {
        card: [],
        link: ["a[href*='/jobs/']"],
        linkPattern: /\/jobs\/\d+-/i,
        title: ["a[href*='/jobs/'] span", "a[href*='/jobs/']", "h3", "h2"],
        company: ["a[href*='/company/'] span", "a[href*='/company/'] h2", "h2"],
        tabs: null,
        next: [],
        nextText: /^(next|load more|show more)$/i,
        require: null
      },
      job: {
        title: ["h1"],
        company: ["[data-test='JobListingCompanyHeader'] a[href*='/company/'] span", "a[href*='/company/'] span"],
        description: ["#job-description", "[class*='description']", "main"],
        applied: [],
        applySel: [],
        applyText: /^(apply|apply now)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site|apply externally/i
      },
      apply: {
        hosts: /(^|\.)wellfound\.com$/i,
        containers: ["[role='dialog']", "[class*='modal']", "[class*='Modal']"],
        chat: null,
        nextText: /^(next|continue)$/i,
        submitText: /^(send application|submit application|apply|submit)$/i,
        errorSel: ["[class*='error']:not(:empty)", "[role='alert']"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    },

    foundit: {
      id: "foundit", name: "Foundit", defaultCap: 15, defaultOn: false,
      hosts: /(^|\.)foundit\.in$/i,
      recommended: ["https://www.foundit.in/rio/recommended-jobs"],
      loginUrl: /\/(rio\/login|login|register)\b/i,
      listing: {
        card: [".srpResultCardContainer", ".cardContainer", "[class*='jobTuple']", "[class*='jobCard']", "[class*='JobCard']"],
        link: ["a[href*='/job/']", ".jobTitle a", "[class*='jobTitle'] a"],
        linkPattern: /\/job\//i,
        title: [".jobTitle", "[class*='jobTitle']", "h3"],
        company: [".companyName", "[class*='companyName']", "[class*='company']"],
        tabs: null,
        next: [".pagination .next", "[class*='arrow-right']"],
        nextText: /^next$/i,
        require: null
      },
      job: {
        title: [".jdTitle", "[class*='jdTitle']", "h1"],
        company: [".jdCompanyName", "[class*='companyName']"],
        description: [".jobDescInfo", "[class*='jobDesc']", "[class*='job-description']"],
        applied: ["[class*='appliedBtn']", ".applied"],
        applySel: ["#applyBtn", "button[class*='applyBtn']", "[class*='applyButton']"],
        applyText: /^(apply|apply now|quick apply)$/i,
        externalSel: [],
        externalText: /apply on company (site|website)|company site/i
      },
      apply: {
        hosts: /(^|\.)foundit\.in$/i,
        containers: ["[role='dialog']", ".modal", "[class*='applyModal']", "[class*='quickApply']"],
        chat: null,
        nextText: /^(next|continue|proceed)$/i,
        submitText: /^(submit|apply|send application)$/i,
        errorSel: ["[class*='error']"],
        success: COMMON_SUCCESS
      },
      rate: COMMON_RATE
    }
  };

  // v2.10: "ATS (company sites)": public Greenhouse / Lever / Ashby job APIs (no login). Runs last; the runner reads the
  // JSON APIs (atsCollect in boardrunner.js) and applies with the saved-jobs autofill agent in the silent window.
  // Every slug below was checked on 2026-11-14 to return JSON with India-located openings.
  BOARDS.ats = {
    id: "ats", ats: true, bestEffort: true, name: "ATS (company sites)", defaultCap: 10, defaultOn: true,
    hosts: /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i,
    recommended: [], loginUrl: /(?!)/, listing: {}, job: {},
    apply: { hosts: /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i, success: COMMON_SUCCESS },
    rate: COMMON_RATE
  };
  const gh = (slug, name) => ({ ats: "greenhouse", slug, name }), lv = (slug, name) => ({ ats: "lever", slug, name }), ab = (slug, name) => ({ ats: "ashby", slug, name });
  const ATS_COMPANIES = [
    gh("groww", "Groww"), gh("druva", "Druva"), gh("hackerrank", "HackerRank"), gh("inmobi", "InMobi"), gh("pubmatic", "PubMatic"),
    gh("rubrik", "Rubrik"), gh("databricks", "Databricks"), gh("mongodb", "MongoDB"), gh("okta", "Okta"), gh("toast", "Toast"),
    gh("gitlab", "GitLab"), gh("elastic", "Elastic"), gh("twilio", "Twilio"), gh("airbnb", "Airbnb"), gh("stripe", "Stripe"),
    gh("coinbase", "Coinbase"), gh("datadog", "Datadog"), gh("yugabyte", "Yugabyte"), gh("newrelic", "New Relic"),
    lv("cred", "CRED"), lv("zeta", "Zeta"), lv("mindtickle", "Mindtickle"), lv("fampay", "FamPay"), lv("hevodata", "Hevo Data"),
    lv("meesho", "Meesho"), lv("paytm", "Paytm"),
    ab("sarvam", "Sarvam AI"), ab("atlan", "Atlan"), ab("composio", "Composio"), ab("plane", "Plane")
  ];
  // v2.10: stop a board on OTP / verification-code prompts (strong phrases only, so profile "verify your number" banners don't trip it).
  const OTP = /enter (the |your )?(otp|one[- ]time (password|passcode|code))|otp (has been |was )?sent|enter (the |your )?(\d-digit )?verification code|verification code (has been |was )?sent to/i;

  g.AP_BOARDS = { BOARDS, ORDER: ["naukri", "internshala", "indeed", "shine", "hirist", "instahyre", "cutshort", "foundit", "wellfound", "ats"], APPLIED_EXACT, OTP, ATS_COMPANIES, EXCLUDED: /(^|\.)linkedin\.com$/i };
})(typeof self !== "undefined" ? self : globalThis);
