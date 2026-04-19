require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VERSION = 'v6-deep-internal';

function ghlGet(token, endpoint) {
  var clean = '';
  for (var i = 0; i < token.length; i++) {
    var code = token.charCodeAt(i);
    if (code >= 32 && code <= 126) clean += token[i];
  }
  clean = clean.trim();
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'services.leadconnectorhq.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + clean,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ' on ' + endpoint));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from ' + endpoint)); }
      });
    });
    req.on('error', function(e) { reject(e); });
    req.setTimeout(20000, function() { req.destroy(); reject(new Error('Timeout on ' + endpoint)); });
    req.end();
  });
}

// ============================================================
// DEEP WORKFLOW ANALYSIS
// ============================================================
function deepAnalyzeWorkflows(workflows) {
  var issues = [];
  var findings = [];
  var active = workflows.filter(function(w) { return w.status === 'published'; });
  var draft = workflows.filter(function(w) { return w.status === 'draft'; });
  var names = workflows.map(function(w) { return (w.name || '').toLowerCase(); });

  // Check each workflow individually
  var workflowDetails = workflows.map(function(w) {
    var detail = {
      name: w.name || 'Unnamed',
      status: w.status || 'unknown',
      issues: [],
      notes: []
    };
    var n = (w.name || '').toLowerCase();
    if (!w.name || w.name.trim() === '' || /^workflow\s*\d+$/i.test(w.name)) {
      detail.issues.push('Generic or missing name -- rename to describe what it does');
    }
    if (w.status === 'draft') {
      detail.issues.push('Still in draft -- not live for contacts');
    }
    if (n.includes('test') || n.includes('copy of') || n.includes('- copy')) {
      detail.issues.push('Looks like a test or duplicate -- review if still needed');
    }
    if (n.includes('appointment') || n.includes('booking')) {
      detail.notes.push('Appointment-related workflow -- verify confirmation and reminder timing');
    }
    if (n.includes('payment') || n.includes('invoice') || n.includes('stripe')) {
      detail.notes.push('Payment workflow -- verify failed payment and receipt branches exist');
    }
    if (n.includes('onboard') || n.includes('welcome') || n.includes('new client')) {
      detail.notes.push('Onboarding workflow -- verify all steps deliver value within 7 days of signup');
    }
    if (n.includes('lead') || n.includes('nurture') || n.includes('follow')) {
      detail.notes.push('Lead nurture workflow -- verify timing gaps are not too long (max 3-5 days between touches)');
    }
    if (n.includes('cancel') || n.includes('churn') || n.includes('refund')) {
      detail.notes.push('Cancellation/churn workflow -- verify it attempts to save the client before processing');
    }
    return detail;
  });

  // Missing critical workflow types
  var hasOnboarding = names.some(function(n) { return n.includes('onboard') || n.includes('welcome') || n.includes('new client'); });
  var hasLeadFollowUp = names.some(function(n) { return n.includes('lead') && (n.includes('follow') || n.includes('nurture') || n.includes('sequence')); });
  var hasAppointment = names.some(function(n) { return n.includes('appointment') || n.includes('booking') || n.includes('confirm') || n.includes('remind'); });
  var hasPaymentFail = names.some(function(n) { return n.includes('payment') && (n.includes('fail') || n.includes('retry') || n.includes('decline')); });
  var hasUnsubscribe = names.some(function(n) { return n.includes('unsub') || n.includes('opt-out') || n.includes('optout'); });
  var hasRenewal = names.some(function(n) { return n.includes('renew') || n.includes('re-engage') || n.includes('winback') || n.includes('expire'); });
  var hasReview = names.some(function(n) { return n.includes('review') || n.includes('reputation'); });
  var hasCancel = names.some(function(n) { return n.includes('cancel') || n.includes('churn'); });
  var hasIntake = names.some(function(n) { return n.includes('intake') || n.includes('application') || n.includes('inquiry'); });

  if (!hasOnboarding) issues.push({ severity: 'critical', title: 'Missing onboarding workflow', detail: 'No workflow found with onboarding/welcome/new client in the name. New clients are not being automatically guided through your process.', fix: 'Create: Welcome email day 1, resource delivery day 2, check-in day 5, next steps day 7.' });
  if (!hasLeadFollowUp) issues.push({ severity: 'critical', title: 'Missing lead follow-up sequence', detail: 'No lead nurture or follow-up workflow detected. Leads that do not convert on first contact are being lost.', fix: 'Build a post-inquiry sequence: immediate response, value email day 2, case study day 4, offer day 7.' });
  if (!hasAppointment) issues.push({ severity: 'critical', title: 'Missing appointment automation', detail: 'No appointment confirmation or reminder workflow found. No-show rates will be higher without automated reminders.', fix: 'Create: booking confirmation email+SMS, 24hr reminder, 1hr SMS reminder, post-appointment follow-up.' });
  if (!hasPaymentFail) issues.push({ severity: 'warning', title: 'Missing failed payment recovery', detail: 'No payment failure workflow detected. Failed payments are silently losing revenue.', fix: 'Create: immediate failed payment alert, day 1 retry reminder, day 3 urgent SMS, day 7 pause access.' });
  if (!hasUnsubscribe) issues.push({ severity: 'warning', title: 'Missing unsubscribe/compliance workflow', detail: 'No unsubscribe handling workflow found. CAN-SPAM and GDPR require immediate opt-out processing.', fix: 'Create workflow triggered by contact unsubscribing that adds DND tag and removes from all active sequences.' });
  if (!hasRenewal) issues.push({ severity: 'warning', title: 'Missing renewal/re-engagement workflow', detail: 'No renewal or win-back workflow found. Expiring clients are not being proactively retained.', fix: 'Create: 30-day before expiry reminder, 14-day reminder with offer, 7-day final notice, post-cancel win-back at 30 days.' });
  if (!hasReview) issues.push({ severity: 'suggestion', title: 'Missing review request workflow', detail: 'No reputation/review workflow found. Positive client experiences are not being converted into reviews.', fix: 'Create workflow triggered 24-48hrs after service delivery that requests a Google or Facebook review.' });
  if (!hasCancel) issues.push({ severity: 'suggestion', title: 'Missing cancellation workflow', detail: 'No cancellation handling workflow found. Clients who cancel get no save attempt or offboarding sequence.', fix: 'Create a cancellation workflow that attempts to save the client with a downsell or pause option before processing.' });
  if (!hasIntake) issues.push({ severity: 'suggestion', title: 'No intake/inquiry workflow detected', detail: 'No workflow found for handling new inquiry or intake form submissions.', fix: 'Create a workflow triggered by intake form submission: immediate confirmation, qualification questions, booking link.' });

  // Generic names
  var generic = workflows.filter(function(w) { return /^workflow\s*\d+$/i.test(w.name || '') || !w.name || w.name.trim() === ''; });
  if (generic.length > 0) issues.push({ severity: 'warning', title: generic.length + ' workflow(s) have generic or missing names', detail: 'Workflows named "Workflow 1" etc cannot be managed at scale. Found: ' + generic.map(function(w) { return '"' + (w.name || 'Unnamed') + '"'; }).join(', '), fix: 'Rename each workflow to describe its trigger and purpose, e.g. "Lead - Post Discovery Call Follow-Up".' });

  var critCount = issues.filter(function(i) { return i.severity === 'critical'; }).length;
  var warnCount = issues.filter(function(i) { return i.severity === 'warning'; }).length;
  var suggCount = issues.filter(function(i) { return i.severity === 'suggestion'; }).length;
  var score = Math.max(0, Math.min(100, 100 - critCount * 20 - warnCount * 8 - suggCount * 3));
  if (active.length === 0) score = Math.min(score, 10);

  return {
    score: score,
    issues: issues,
    expert: active.length + ' active workflows, ' + draft.length + ' in draft. ' + (critCount > 0 ? critCount + ' critical gaps in automation coverage.' : 'Core automation types are covered.'),
    stats: { total: workflows.length, active: active.length, draft: draft.length },
    details: workflowDetails
  };
}

// ============================================================
// DEEP CONTACT ANALYSIS
// ============================================================
function deepAnalyzeContacts(contacts) {
  var issues = [];
  var total = contacts.length;
  if (total === 0) {
    issues.push({ severity: 'warning', title: 'No contacts found', detail: 'No contacts in this account. Either the account is brand new or the wrong Location ID was used.', fix: 'Verify the Location ID is correct and that contacts have been imported or created.' });
    return { score: 50, issues: issues, expert: 'No contacts found.', stats: { total: 0 }, details: [] };
  }

  var withEmail = contacts.filter(function(c) { return c.email; }).length;
  var withPhone = contacts.filter(function(c) { return c.phone; }).length;
  var withTags = contacts.filter(function(c) { return c.tags && c.tags.length > 0; }).length;
  var withSource = contacts.filter(function(c) { return c.source; }).length;
  var withDND = contacts.filter(function(c) { return c.dnd; }).length;
  var emailPct = Math.round(withEmail / total * 100);
  var phonePct = Math.round(withPhone / total * 100);
  var tagPct = Math.round(withTags / total * 100);

  // Tag analysis
  var allTags = [];
  contacts.forEach(function(c) { if (c.tags) c.tags.forEach(function(t) { allTags.push(t); }); });
  var tagCounts = {};
  allTags.forEach(function(t) { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  var topTags = Object.keys(tagCounts).sort(function(a, b) { return tagCounts[b] - tagCounts[a]; }).slice(0, 10);

  // Contact-level details
  var contactDetails = contacts.slice(0, 50).map(function(c) {
    var issues = [];
    if (!c.email && !c.phone) issues.push('No email or phone -- cannot be contacted');
    else if (!c.email) issues.push('Missing email -- cannot receive email campaigns');
    else if (!c.phone) issues.push('Missing phone -- cannot receive SMS');
    if (!c.tags || c.tags.length === 0) issues.push('No tags -- not segmented');
    if (!c.firstName && !c.lastName) issues.push('No name on record');
    if (c.dnd) issues.push('DND enabled -- all messaging blocked');
    return {
      name: (c.firstName || '') + ' ' + (c.lastName || '') || 'No name',
      email: c.email || 'none',
      phone: c.phone || 'none',
      tags: c.tags || [],
      source: c.source || 'unknown',
      dnd: c.dnd || false,
      issues: issues
    };
  });

  if (emailPct < 70) issues.push({ severity: 'critical', title: 'Only ' + emailPct + '% of contacts have an email', detail: withEmail + ' of ' + total + ' contacts have email addresses. Email campaigns cannot reach the other ' + (total - withEmail) + '.', fix: 'Add email capture to all forms and landing pages. Run an enrichment campaign to collect missing emails.' });
  if (phonePct < 50) issues.push({ severity: 'warning', title: 'Only ' + phonePct + '% of contacts have a phone number', detail: withPhone + ' of ' + total + ' contacts have phone numbers. SMS workflows are ineffective without phone coverage.', fix: 'Add phone as a required field on all intake forms.' });
  if (tagPct < 40) issues.push({ severity: 'warning', title: 'Only ' + tagPct + '% of contacts are tagged', detail: withTags + ' of ' + total + ' contacts have tags. Without tags, targeted segmentation is impossible.', fix: 'Create a tagging strategy: tag by lead source, lifecycle stage, service type, and engagement level.' });
  if (withSource < total * 0.5) issues.push({ severity: 'suggestion', title: 'Less than 50% of contacts have a lead source recorded', detail: 'Without source tracking, you cannot measure which marketing channels are working.', fix: 'Set lead source on all forms and workflows. Use UTM parameters on ad campaigns.' });
  if (withDND > total * 0.1) issues.push({ severity: 'warning', title: withDND + ' contacts (' + Math.round(withDND/total*100) + '%) have DND enabled', detail: 'High DND rates suggest poor list hygiene or compliance issues.', fix: 'Audit why contacts have DND set. Ensure unsubscribe workflows are working correctly.' });

  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 25 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 10 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return {
    score: score,
    issues: issues,
    expert: total + ' contacts. Email: ' + emailPct + '%, Phone: ' + phonePct + '%, Tagged: ' + tagPct + '%. Top tags: ' + (topTags.length > 0 ? topTags.join(', ') : 'none'),
    stats: { total: total, withEmail: withEmail, withPhone: withPhone, withTags: withTags, topTags: topTags },
    details: contactDetails
  };
}

// ============================================================
// DEEP PIPELINE ANALYSIS
// ============================================================
function deepAnalyzePipelines(pipelines, opportunities) {
  var issues = [];
  if (pipelines.length === 0) {
    issues.push({ severity: 'critical', title: 'No pipelines configured', detail: 'Without pipelines, there is no structured way to track leads through your sales process.', fix: 'Create at minimum: a Lead/Prospect pipeline and a Client Lifecycle pipeline.' });
    return { score: 0, issues: issues, expert: 'No pipelines found.', stats: { pipelines: 0, opportunities: 0, stale: 0 }, details: [] };
  }

  var now = Date.now();
  var pipelineDetails = pipelines.map(function(p) {
    var pOpps = opportunities.filter(function(o) { return o.pipelineId === p.id; });
    var stale = pOpps.filter(function(o) { if (!o.updatedAt) return false; return (now - new Date(o.updatedAt).getTime()) / 86400000 > 30; });
    var stages = p.stages || [];
    var stageIssues = [];
    if (stages.length < 3) stageIssues.push('Only ' + stages.length + ' stage(s) -- consider adding more granular stages');
    if (!stages.some(function(s) { return (s.name || '').toLowerCase().includes('close') || (s.name || '').toLowerCase().includes('won') || (s.name || '').toLowerCase().includes('lost'); })) {
      stageIssues.push('No closed/won/lost stage found -- pipeline has no clear end state');
    }
    return {
      name: p.name || 'Unnamed Pipeline',
      stageCount: stages.length,
      stages: stages.map(function(s) { return s.name || 'Unnamed'; }),
      opportunityCount: pOpps.length,
      staleCount: stale.length,
      issues: stageIssues
    };
  });

  var stale = opportunities.filter(function(o) { if (!o.updatedAt) return false; return (now - new Date(o.updatedAt).getTime()) / 86400000 > 30; });
  if (pipelines.length === 1) issues.push({ severity: 'warning', title: 'Only one pipeline configured', detail: 'A single pipeline cannot adequately separate pre-sale leads from post-sale client management.', fix: 'Add a Client Lifecycle pipeline with stages: Onboarding, Active, At Risk, Churned.' });
  if (stale.length > 0) issues.push({ severity: 'warning', title: stale.length + ' stale opportunities (30+ days unchanged)', detail: 'Stale opportunities clog your pipeline and skew conversion data.', fix: 'Review and close, re-engage, or delete all opportunities not updated in 30+ days.' });
  issues.push({ severity: 'suggestion', title: 'Verify stage-change automations exist', detail: 'Every stage change should trigger an appropriate workflow.', fix: 'For each key stage in each pipeline, create a workflow triggered by "Opportunity Stage Changed".' });

  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return {
    score: score,
    issues: issues,
    expert: pipelines.length + ' pipeline(s), ' + opportunities.length + ' opportunities, ' + stale.length + ' stale.',
    stats: { pipelines: pipelines.length, opportunities: opportunities.length, stale: stale.length },
    details: pipelineDetails
  };
}

// ============================================================
// DEEP CALENDAR ANALYSIS
// ============================================================
function deepAnalyzeCalendars(calendars) {
  var issues = [];
  if (calendars.length === 0) {
    issues.push({ severity: 'critical', title: 'No calendars configured', detail: 'No booking calendars are set up. Clients cannot self-book.', fix: 'Create at minimum: a discovery call calendar and a service delivery calendar.' });
    return { score: 0, issues: issues, expert: 'No calendars found.', stats: { total: 0 }, details: [] };
  }

  var calendarDetails = calendars.map(function(c) {
    var cal = {
      name: c.name || 'Unnamed',
      type: c.calendarType || c.type || 'unknown',
      teamMembers: (c.teamMembers || []).length,
      issues: [],
      notes: []
    };
    if (!c.teamMembers || c.teamMembers.length === 0) cal.issues.push('No team members assigned -- bookings may not route to anyone');
    if (!c.description) cal.notes.push('No description set -- clients will not know what this booking is for');
    if (c.slotDuration && c.slotDuration < 15) cal.issues.push('Slot duration is very short (' + c.slotDuration + ' min) -- verify this is intentional');
    if (!c.autoConfirm && c.autoConfirm !== undefined) cal.notes.push('Auto-confirm is off -- bookings require manual approval');
    var n = (c.name || '').toLowerCase();
    if (n.includes('discovery') || n.includes('intro') || n.includes('consult')) cal.notes.push('Discovery/intro calendar -- verify a lead nurture workflow fires if they do not convert after this call');
    if (n.includes('coaching') || n.includes('session') || n.includes('service')) cal.notes.push('Service delivery calendar -- verify a post-session follow-up workflow exists');
    return cal;
  });

  var noTeam = calendars.filter(function(c) { return !c.teamMembers || c.teamMembers.length === 0; });
  if (noTeam.length > 0) issues.push({ severity: 'warning', title: noTeam.length + ' calendar(s) have no team members: ' + noTeam.map(function(c) { return '"' + (c.name || 'Unnamed') + '"'; }).join(', '), detail: 'Calendars without assigned team members may not route bookings correctly.', fix: 'Go to each calendar settings and assign the appropriate team member(s).' });
  issues.push({ severity: 'suggestion', title: 'Verify reminder and follow-up workflows are connected to all calendars', detail: 'GHL does not auto-send reminders. Each calendar needs a workflow triggered by Appointment Booked.', fix: 'Create or verify: booking confirmation, 24hr reminder, 1hr SMS reminder, post-appointment follow-up.' });

  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return {
    score: score,
    issues: issues,
    expert: calendars.length + ' calendar(s): ' + calendars.map(function(c) { return '"' + (c.name || 'Unnamed') + '" (' + (c.calendarType || c.type || 'standard') + ')'; }).join(', '),
    stats: { total: calendars.length },
    details: calendarDetails
  };
}

// ============================================================
// DEEP FORM ANALYSIS
// ============================================================
function deepAnalyzeForms(forms, surveys) {
  var issues = [];
  var formDetails = forms.map(function(f) {
    var detail = { name: f.name || 'Unnamed', type: 'form', fields: (f.fields || []).length, issues: [], notes: [] };
    if (!f.name || f.name.trim() === '') detail.issues.push('No name set -- give this form a descriptive name');
    var n = (f.name || '').toLowerCase();
    if (n.includes('test')) detail.issues.push('Name suggests this is a test form -- verify if still needed');
    var fieldNames = (f.fields || []).map(function(field) { return (field.label || field.fieldKey || '').toLowerCase(); });
    if (!fieldNames.some(function(fn) { return fn.includes('email'); })) detail.issues.push('No email field found -- form cannot capture email addresses');
    if (!fieldNames.some(function(fn) { return fn.includes('phone') || fn.includes('mobile'); })) detail.notes.push('No phone field -- consider adding for SMS follow-up');
    if (n.includes('intake') || n.includes('application') || n.includes('onboard')) detail.notes.push('Intake form -- verify this triggers an onboarding or application review workflow');
    if (n.includes('contact') || n.includes('inquiry') || n.includes('lead')) detail.notes.push('Lead capture form -- verify this triggers an immediate follow-up workflow');
    if (n.includes('feedback') || n.includes('nps') || n.includes('review')) detail.notes.push('Feedback form -- verify responses are being reviewed regularly');
    return detail;
  });

  var surveyDetails = surveys.map(function(s) {
    return { name: s.name || 'Unnamed', type: 'survey', questions: (s.fields || []).length, issues: [], notes: ['Survey -- verify it is connected to a workflow and responses are actively reviewed'] };
  });

  if (forms.length + surveys.length === 0) {
    issues.push({ severity: 'critical', title: 'No forms or surveys found', detail: 'No forms exist. Lead capture, intake, and feedback collection is entirely manual.', fix: 'Create at minimum: a lead inquiry form, a client intake form, and a feedback form.' });
    return { score: 0, issues: issues, expert: 'No forms found.', stats: { forms: 0, surveys: 0 }, details: [] };
  }
  if (surveys.length === 0) issues.push({ severity: 'suggestion', title: 'No surveys configured', detail: 'Surveys collect structured multi-step data and are ideal for NPS, qualification, and intake.', fix: 'Add at least one survey for client feedback or lead qualification.' });
  issues.push({ severity: 'suggestion', title: 'Verify every form triggers a workflow on submission', detail: 'Forms without connected workflows are capturing data and doing nothing with it.', fix: 'For each form below, confirm there is a workflow triggered by "Form Submitted".' });

  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return {
    score: score,
    issues: issues,
    expert: forms.length + ' form(s): ' + forms.map(function(f) { return '"' + (f.name || 'Unnamed') + '"'; }).join(', ') + (surveys.length > 0 ? '. Surveys: ' + surveys.map(function(s) { return '"' + (s.name || 'Unnamed') + '"'; }).join(', ') : '. No surveys.'),
    stats: { forms: forms.length, surveys: surveys.length },
    details: formDetails.concat(surveyDetails)
  };
}

// ============================================================
// DEEP CUSTOM VALUES ANALYSIS
// ============================================================
function deepAnalyzeCustomValues(customValues) {
  var issues = [];
  var categories = {};
  customValues.forEach(function(cv) {
    var folder = cv.fieldKey ? cv.fieldKey.split('.')[0] : 'uncategorized';
    if (!categories[folder]) categories[folder] = [];
    categories[folder].push(cv);
  });

  var cvDetails = customValues.map(function(cv) {
    var detail = { name: cv.name || 'Unnamed', key: cv.fieldKey || '', value: cv.value ? (cv.value.length > 60 ? cv.value.substring(0, 60) + '...' : cv.value) : 'empty', issues: [] };
    if (!cv.value || cv.value.trim() === '') detail.issues.push('Value is empty -- this will render as blank in emails and workflows');
    if (!cv.name || cv.name.trim() === '') detail.issues.push('No name set');
    return detail;
  });

  var emptyValues = customValues.filter(function(cv) { return !cv.value || cv.value.trim() === ''; });
  if (emptyValues.length > 0) issues.push({ severity: 'warning', title: emptyValues.length + ' custom value(s) are empty', detail: 'Empty custom values: ' + emptyValues.map(function(cv) { return '"' + (cv.name || cv.fieldKey || 'Unnamed') + '"'; }).join(', ') + '. These render as blank in all emails and workflows that use them.', fix: 'Fill in all empty custom values or remove them if not needed.' });
  if (customValues.length === 0) issues.push({ severity: 'warning', title: 'No custom values configured', detail: 'Custom values store reusable business data used in emails, workflows, and funnels.', fix: 'Add: business name, booking link, website URL, service prices, social links, team member names.' });
  if (customValues.length < 5 && customValues.length > 0) issues.push({ severity: 'suggestion', title: 'Few custom values set up', detail: 'A well-built account has 15-40 custom values covering all dynamic content in templates.', fix: 'Expand with: pricing tiers, resource links, team bios, social media handles, address, policies.' });

  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  var categoryList = Object.keys(categories).map(function(k) { return k + ' (' + categories[k].length + ')'; }).join(', ');
  return {
    score: score,
    issues: issues,
    expert: customValues.length + ' custom value(s) across categories: ' + (categoryList || 'none') + '. ' + (emptyValues.length > 0 ? emptyValues.length + ' are empty.' : 'All values populated.'),
    stats: { total: customValues.length, empty: emptyValues.length, categories: Object.keys(categories).length },
    details: cvDetails
  };
}

// ============================================================
// DEEP CUSTOM FIELDS ANALYSIS
// ============================================================
function deepAnalyzeCustomFields(customFields) {
  var issues = [];
  if (customFields.length === 0) {
    issues.push({ severity: 'warning', title: 'No custom fields configured', detail: 'Custom fields extend contact records to store business-specific data like service type, coaching goals, health history etc.', fix: 'Create custom fields for every key data point in your client journey.' });
    return { score: 70, issues: issues, expert: 'No custom fields found.', stats: { total: 0 }, details: [] };
  }

  var fieldDetails = customFields.map(function(f) {
    var detail = { name: f.name || 'Unnamed', key: f.fieldKey || '', dataType: f.dataType || 'text', placeholder: f.placeholder || '', issues: [] };
    if (!f.name || f.name.trim() === '') detail.issues.push('No name set for this field');
    return detail;
  });

  var dataTypes = {};
  customFields.forEach(function(f) { var t = f.dataType || 'text'; dataTypes[t] = (dataTypes[t] || 0) + 1; });
  var typeBreakdown = Object.keys(dataTypes).map(function(k) { return k + ': ' + dataTypes[k]; }).join(', ');

  issues.push({ severity: 'suggestion', title: 'Verify all custom fields are being populated by forms or workflows', detail: 'Custom fields with no data are wasted setup. Check that every field is captured somewhere.', fix: 'Map each custom field to the form or workflow step that should populate it.' });

  var score = 90;
  return {
    score: score,
    issues: issues,
    expert: customFields.length + ' custom field(s). Types: ' + typeBreakdown + '. Fields: ' + customFields.map(function(f) { return '"' + (f.name || 'Unnamed') + '"'; }).join(', '),
    stats: { total: customFields.length },
    details: fieldDetails
  };
}

// ============================================================
// SETTINGS ANALYSIS (unchanged)
// ============================================================
function analyzeSettings(location) {
  var issues = [];
  var emailOk = !!(location.email || location.businessEmail);
  var phoneOk = !!(location.phone);
  var tzOk = !!(location.timezone);
  var logoOk = !!(location.logoUrl);
  var addrOk = !!(location.address);
  if (!emailOk) issues.push({ severity: 'critical', title: 'No sender email address configured', detail: 'All outgoing emails will use a default address. This hurts deliverability.', fix: 'Go to Settings > Business Info > Email and add your verified sender email address.' });
  if (!phoneOk) issues.push({ severity: 'critical', title: 'No phone/SMS number configured', detail: 'SMS workflows cannot send without a configured phone number.', fix: 'Go to Settings > Phone Numbers and add or purchase a Twilio/LC Phone number.' });
  if (!tzOk) issues.push({ severity: 'warning', title: 'No timezone configured', detail: 'Scheduled sends and appointments may fire at the wrong time.', fix: 'Set the correct timezone under Settings > Business Info.' });
  if (!logoOk) issues.push({ severity: 'suggestion', title: 'No logo uploaded', detail: 'Missing logo affects branding on emails, funnels, and the client portal.', fix: 'Upload your logo under Settings > Business Info.' });
  if (!addrOk) issues.push({ severity: 'suggestion', title: 'No business address on file', detail: 'A physical address is legally required in marketing email footers (CAN-SPAM).', fix: 'Add your business address under Settings > Business Info.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 25 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 10 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return {
    score: score,
    issues: issues,
    expert: 'Email: ' + (emailOk ? location.email || location.businessEmail : 'NOT SET') + '. Phone: ' + (phoneOk ? location.phone : 'NOT SET') + '. Timezone: ' + (location.timezone || 'NOT SET') + '.',
    stats: { emailOk: emailOk, phoneOk: phoneOk, tzOk: tzOk, logoOk: logoOk, addrOk: addrOk },
    details: [{ name: location.name || 'Sub-account', email: location.email || 'none', phone: location.phone || 'none', timezone: location.timezone || 'none', address: location.address || 'none', logo: location.logoUrl ? 'set' : 'missing' }]
  };
}

function buildOverallScore(sections) {
  var scores = Object.values(sections).map(function(s) { return s.score; });
  return Math.round(scores.reduce(function(a, b) { return a + b; }, 0) / scores.length);
}

function buildAllIssues(sections) {
  var order = { critical: 0, warning: 1, suggestion: 2 };
  var all = [];
  Object.keys(sections).forEach(function(key) {
    (sections[key].issues || []).forEach(function(issue) {
      all.push(Object.assign({}, issue, { section: key }));
    });
  });
  return all.sort(function(a, b) { return (order[a.severity] || 3) - (order[b.severity] || 3); });
}

// ============================================================
// VERSION + AUDIT ROUTES
// ============================================================
app.get('/version', function(req, res) { res.json({ version: VERSION }); });

app.post('/api/audit', async function(req, res) {
  var rawToken = String(req.body.token || '');
  var locationId = String(req.body.locationId || '').trim();
  if (!rawToken || !locationId) return res.status(400).json({ error: 'Token and Location ID are required.' });

  var results = {};
  var errors = {};

  // 1. Settings
  try {
    var data = await ghlGet(rawToken, '/locations/' + locationId);
    var loc = data.location || data;
    results.settings = analyzeSettings(loc);
    results.settings.location = { name: loc.name, email: loc.email || loc.businessEmail, phone: loc.phone, timezone: loc.timezone, logoUrl: loc.logoUrl };
  } catch (e) {
    errors.settings = e.message;
    results.settings = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch location settings', detail: e.message, fix: 'Check that your token has locations.readonly scope.' }], expert: 'Could not fetch location settings.', stats: {}, details: [] };
  }

  // 2. Contacts
  try {
    var cData = await ghlGet(rawToken, '/contacts/?locationId=' + locationId + '&limit=100');
    results.contacts = deepAnalyzeContacts(cData.contacts || []);
  } catch (e) {
    errors.contacts = e.message;
    results.contacts = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch contacts', detail: e.message, fix: 'Ensure contacts.readonly scope is enabled.' }], expert: 'API error.', stats: { total: 0 }, details: [] };
  }

  // 3. Pipelines + Opportunities
  try {
    var pData = await ghlGet(rawToken, '/opportunities/pipelines/?locationId=' + locationId);
    var pipelines = pData.pipelines || [];
    var opportunities = [];
    try { var oData = await ghlGet(rawToken, '/opportunities/search/?location_id=' + locationId + '&limit=100'); opportunities = oData.opportunities || []; } catch (_) {}
    results.pipelines = deepAnalyzePipelines(pipelines, opportunities);
  } catch (e) {
    errors.pipelines = e.message;
    results.pipelines = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch pipelines', detail: e.message, fix: 'Ensure opportunities.readonly scope is enabled.' }], expert: 'API error.', stats: { pipelines: 0, opportunities: 0, stale: 0 }, details: [] };
  }

  // 4. Workflows
  try {
    var wData = await ghlGet(rawToken, '/workflows/?locationId=' + locationId);
    results.workflows = deepAnalyzeWorkflows(wData.workflows || []);
  } catch (e) {
    errors.workflows = e.message;
    results.workflows = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch workflows', detail: e.message, fix: 'Ensure workflows.readonly scope is enabled.' }], expert: 'API error.', stats: { total: 0, active: 0, draft: 0 }, details: [] };
  }

  // 5. Calendars
  try {
    var calData = await ghlGet(rawToken, '/calendars/?locationId=' + locationId);
    results.calendars = deepAnalyzeCalendars(calData.calendars || []);
  } catch (e) {
    errors.calendars = e.message;
    results.calendars = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch calendars', detail: e.message, fix: 'Ensure calendars.readonly scope is enabled.' }], expert: 'API error.', stats: { total: 0 }, details: [] };
  }

  // 6. Forms + Surveys
  try {
    var fData = await ghlGet(rawToken, '/forms/?locationId=' + locationId + '&limit=100');
    var surveys = [];
    try { var sData = await ghlGet(rawToken, '/surveys/?locationId=' + locationId + '&limit=100'); surveys = sData.surveys || []; } catch (_) {}
    results.forms = deepAnalyzeForms(fData.forms || [], surveys);
  } catch (e) {
    errors.forms = e.message;
    results.forms = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch forms', detail: e.message, fix: 'Ensure forms.readonly scope is enabled.' }], expert: 'API error.', stats: { forms: 0, surveys: 0 }, details: [] };
  }

  // 7. Custom Values
  try {
    var cvData = await ghlGet(rawToken, '/locations/' + locationId + '/customValues');
    results.customValues = deepAnalyzeCustomValues(cvData.customValues || []);
  } catch (e) {
    errors.customValues = e.message;
    results.customValues = { score: 50, issues: [{ severity: 'suggestion', title: 'Could not fetch custom values', detail: e.message, fix: 'Ensure locations/customValues.readonly scope is enabled.' }], expert: 'API error.', stats: { total: 0 }, details: [] };
  }

  // 8. Custom Fields
  try {
    var cfData = await ghlGet(rawToken, '/locations/' + locationId + '/customFields');
    results.customFields = deepAnalyzeCustomFields(cfData.customFields || []);
  } catch (e) {
    errors.customFields = e.message;
    results.customFields = { score: 70, issues: [{ severity: 'suggestion', title: 'Could not fetch custom fields', detail: e.message, fix: 'Ensure locations/customFields.readonly scope is enabled.' }], expert: 'API error.', stats: { total: 0 }, details: [] };
  }

  // 9. Funnels
  try {
    var funData = await ghlGet(rawToken, '/funnels/?locationId=' + locationId + '&limit=100');
    var funnels = funData.funnels || [];
    var fIssues = [];
    var fDetails = funnels.map(function(f) {
      var d = { name: f.name || 'Unnamed', type: f.type || 'funnel', domain: f.domainConfig ? f.domainConfig.url || 'custom' : 'no custom domain', pageCount: (f.pages || []).length, issues: [] };
      if (!f.domainConfig) d.issues.push('No custom domain -- using default GHL URL which looks unprofessional');
      if ((f.pages || []).length < 2) d.issues.push('Only ' + (f.pages || []).length + ' page(s) -- most funnels need at least an opt-in and a thank-you page');
      return d;
    });
    if (funnels.length === 0) fIssues.push({ severity: 'warning', title: 'No funnels or websites found', detail: 'No funnels are set up for lead capture or service delivery.', fix: 'Build at minimum: a lead magnet/opt-in page and a thank-you page that triggers a nurture workflow.' });
    var noDomain = funnels.filter(function(f) { return !f.domainConfig; });
    if (noDomain.length > 0) fIssues.push({ severity: 'warning', title: noDomain.length + ' funnel(s) have no custom domain', detail: noDomain.map(function(f) { return '"' + (f.name || 'Unnamed') + '"'; }).join(', ') + ' are on default GHL URLs.', fix: 'Connect a custom domain to each active funnel under Funnels > Settings > Domain.' });
    var fScore = funnels.length === 0 ? 30 : Math.max(50, 100 - fIssues.filter(function(i) { return i.severity === 'warning'; }).length * 15);
    results.funnels = { score: fScore, issues: fIssues, expert: funnels.length + ' funnel/website(s): ' + (funnels.length > 0 ? funnels.map(function(f) { return '"' + (f.name || 'Unnamed') + '"'; }).join(', ') : 'none found'), stats: { total: funnels.length }, details: fDetails };
  } catch (e) {
    errors.funnels = e.message;
    results.funnels = { score: 50, issues: [{ severity: 'warning', title: 'Funnels scope needed', detail: e.message, fix: 'Add funnels/funnel.readonly scope to your integration token.' }], expert: 'Could not fetch funnels.', stats: { total: 0 }, details: [] };
  }

  res.json({ version: VERSION, overallScore: buildOverallScore(results), sections: results, allIssues: buildAllIssues(results), errors: errors });
});

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('GHL Expert Audit ' + VERSION + ' running on port ' + PORT); });
