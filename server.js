require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VERSION = 'v5-nodehttps-sanitized';

const https = require('https');

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
    req.setTimeout(15000, function() { req.abort(); reject(new Error('Timeout on ' + endpoint)); });
    req.end();
  });
}

function analyzeWorkflows(workflows) {
  var issues = [];
  var active = workflows.filter(function(w) { return w.status === 'published'; });
  var draft = workflows.filter(function(w) { return w.status === 'draft'; });
  var names = workflows.map(function(w) { return (w.name || '').toLowerCase(); });

  if (!names.some(function(n) { return n.includes('onboard') || n.includes('welcome') || n.includes('new client'); }))
    issues.push({ severity: 'critical', title: 'Missing onboarding workflow', detail: 'No onboarding workflow detected. New clients are not being guided through your process automatically.', fix: 'Create a new client onboarding workflow: welcome email, resource delivery, next steps, and check-in sequence.' });
  if (!names.some(function(n) { return n.includes('lead') && (n.includes('follow') || n.includes('nurture') || n.includes('sequence')); }))
    issues.push({ severity: 'critical', title: 'Missing lead follow-up automation', detail: 'No lead follow-up or nurture sequence found. Leads that do not convert immediately are being lost.', fix: 'Build an after-intro-call workflow that sends follow-up emails based on whether the lead purchased or not.' });
  if (!names.some(function(n) { return n.includes('appointment') || n.includes('booking') || n.includes('confirm') || n.includes('remind'); }))
    issues.push({ severity: 'critical', title: 'No appointment confirmation workflow', detail: 'No workflow to confirm, remind, or follow up on appointments. This directly causes no-shows.', fix: 'Create appointment automation: confirmation email on booking, 24hr reminder, 1hr SMS reminder, post-appointment follow-up.' });
  if (!names.some(function(n) { return n.includes('payment') && (n.includes('fail') || n.includes('retry') || n.includes('decline')); }))
    issues.push({ severity: 'warning', title: 'No failed payment workflow', detail: 'If a client payment fails, there is no automated recovery process.', fix: 'Create a failed payment workflow: immediate notification email + SMS, retry reminders.' });
  if (!names.some(function(n) { return n.includes('unsub') || n.includes('opt-out') || n.includes('optout'); }))
    issues.push({ severity: 'warning', title: 'No unsubscribe handling workflow', detail: 'Without an unsubscribe workflow, contact compliance may be at risk.', fix: 'Create an unsubscribe workflow that tags contacts and removes them from active campaigns immediately.' });
  if (!names.some(function(n) { return n.includes('renew') || n.includes('re-engage') || n.includes('winback') || n.includes('expire'); }))
    issues.push({ severity: 'suggestion', title: 'No re-engagement or renewal workflow', detail: 'No workflows detected for re-engaging past clients or renewing subscriptions.', fix: 'Build a renewal reminder workflow 30/14/7 days before expiration, and a win-back sequence for churned clients.' });
  if (!names.some(function(n) { return n.includes('review') || n.includes('reputation'); }))
    issues.push({ severity: 'suggestion', title: 'No review request workflow', detail: 'No automated review or reputation management workflow found.', fix: 'Add a post-service review request workflow that sends via SMS or email 24-48 hours after completion.' });

  var generic = workflows.filter(function(w) { return /^workflow\s*\d+$/i.test(w.name || ''); });
  if (generic.length > 2) issues.push({ severity: 'warning', title: generic.length + ' workflows have generic names', detail: 'Workflows named Workflow 1 etc. are impossible to manage at scale.', fix: 'Rename all workflows to clearly describe their trigger and purpose.' });
  if (draft.length > 5) issues.push({ severity: 'warning', title: draft.length + ' workflows still in draft', detail: 'Many workflows are sitting in draft and not active.', fix: 'Review draft workflows - publish the ones that are ready, delete the rest.' });
  if (active.length === 0 && workflows.length === 0) issues.push({ severity: 'critical', title: 'No workflows found', detail: 'This account has zero workflows.', fix: 'Create essential workflows: lead nurture, appointment confirmation, onboarding series, and payment receipt.' });

  var crits = issues.filter(function(i) { return i.severity === 'critical'; }).length;
  var warns = issues.filter(function(i) { return i.severity === 'warning'; }).length;
  var suggs = issues.filter(function(i) { return i.severity === 'suggestion'; }).length;
  var score = Math.max(0, Math.min(100, 100 - crits * 20 - warns * 8 - suggs * 3));
  if (active.length === 0) score = Math.min(score, 10);

  var expert = active.length === 0 ? 'Zero workflows is a critical gap -- this account is running entirely manually.'
    : active.length < 5 ? 'Only ' + active.length + ' active workflows is below the threshold for a production account.'
    : active.length + ' active workflows shows good automation usage. Focus on ensuring the core client journey flows are covered.';

  return { score: score, issues: issues, expert: expert, stats: { total: workflows.length, active: active.length, draft: draft.length } };
}

function analyzeContacts(contacts) {
  var issues = [];
  var total = contacts.length;
  if (total === 0) {
    issues.push({ severity: 'warning', title: 'No contacts found', detail: 'No contacts in this account. Either the account is brand new or the wrong Location ID was used.', fix: 'Verify the Location ID is correct and that contacts have been imported or created.' });
    return { score: 50, issues: issues, expert: 'No contacts found -- verify this is the correct sub-account.', stats: { total: 0, withEmail: 0, withPhone: 0, withTags: 0 } };
  }
  var withEmail = contacts.filter(function(c) { return c.email; }).length;
  var withPhone = contacts.filter(function(c) { return c.phone; }).length;
  var withTags = contacts.filter(function(c) { return c.tags && c.tags.length > 0; }).length;
  var emailPct = Math.round(withEmail / total * 100);
  var phonePct = Math.round(withPhone / total * 100);
  var tagPct = Math.round(withTags / total * 100);
  if (emailPct < 70) issues.push({ severity: 'critical', title: 'Only ' + emailPct + '% of contacts have an email', detail: 'Low email coverage severely limits your ability to run email campaigns.', fix: 'Run a data enrichment pass or add an email capture step to all intake forms.' });
  if (phonePct < 50) issues.push({ severity: 'warning', title: 'Only ' + phonePct + '% of contacts have a phone number', detail: 'Low phone coverage limits SMS workflows and call-based follow-ups.', fix: 'Add phone as a required field on all forms and landing pages.' });
  if (tagPct < 40) issues.push({ severity: 'warning', title: 'Only ' + tagPct + '% of contacts are tagged', detail: 'Without tags, segmentation and targeted campaigns are not possible.', fix: 'Implement a tagging strategy: tag by lead source, stage, service type, and status.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 25 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 10);
  return { score: score, issues: issues, expert: total + ' contacts with ' + emailPct + '% email coverage and ' + tagPct + '% tagging. ' + (tagPct < 40 ? 'Tagging hygiene needs attention.' : 'Tag coverage is reasonable.'), stats: { total: total, withEmail: withEmail, withPhone: withPhone, withTags: withTags } };
}

function analyzePipelines(pipelines, opportunities) {
  var issues = [];
  if (pipelines.length === 0) {
    issues.push({ severity: 'critical', title: 'No pipelines configured', detail: 'Without pipelines, there is no structured way to track leads through your sales process.', fix: 'Create at minimum: a Lead/Prospect pipeline and a Client Lifecycle pipeline.' });
    return { score: 0, issues: issues, expert: 'Missing pipelines means zero visibility into your sales funnel.', stats: { pipelines: 0, opportunities: 0, stale: 0 } };
  }
  if (pipelines.length === 1) issues.push({ severity: 'warning', title: 'Only one pipeline configured', detail: 'A single pipeline is usually not enough to handle both lead tracking and client lifecycle management.', fix: 'Consider adding a separate Client Lifecycle pipeline to separate pre-sale from post-sale.' });
  var now = Date.now();
  var stale = opportunities.filter(function(o) { if (!o.updatedAt) return false; return (now - new Date(o.updatedAt).getTime()) / 86400000 > 30; });
  if (stale.length > 0) issues.push({ severity: 'warning', title: stale.length + ' stale opportunities (30+ days without update)', detail: 'Opportunities sitting unchanged for over 30 days are likely lost deals clogging your pipeline.', fix: 'Review stale opportunities monthly -- close lost deals, re-engage warm ones, delete dead ones.' });
  issues.push({ severity: 'suggestion', title: 'Verify stage-change automations are connected', detail: 'Pipelines are most powerful when workflow automations fire on stage changes.', fix: 'Add workflow triggers for each key pipeline stage.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return { score: score, issues: issues, expert: pipelines.length + ' pipeline(s) with ' + opportunities.length + ' total opportunities. ' + (stale.length > 0 ? stale.length + ' stale opportunities need review.' : 'No stale opportunities detected.'), stats: { pipelines: pipelines.length, opportunities: opportunities.length, stale: stale.length } };
}

function analyzeCalendars(calendars) {
  var issues = [];
  if (calendars.length === 0) {
    issues.push({ severity: 'critical', title: 'No calendars configured', detail: 'No booking calendars are set up. Clients cannot self-book, and appointment workflows have no trigger.', fix: 'Create at minimum: an introductory/discovery call calendar and a main service delivery calendar.' });
    return { score: 0, issues: issues, expert: 'No calendars means clients cannot self-book. This is a critical gap for any service business.', stats: { total: 0, withTeam: 0 } };
  }
  var withTeam = calendars.filter(function(c) { return c.teamMembers && c.teamMembers.length > 0; }).length;
  if (withTeam < calendars.length) issues.push({ severity: 'warning', title: (calendars.length - withTeam) + ' calendar(s) have no team members assigned', detail: 'Calendars without team members may not route bookings correctly.', fix: 'Assign at least one team member to every active calendar.' });
  issues.push({ severity: 'suggestion', title: 'Verify appointment reminder automations are connected', detail: 'GHL calendars do not automatically send reminders -- you must connect a workflow.', fix: 'Create a workflow triggered by Appointment Booked that sends confirmation + 24hr + 1hr SMS/email reminders.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return { score: score, issues: issues, expert: calendars.length + ' calendar(s) configured. ' + (withTeam < calendars.length ? 'Some calendars lack assigned team members.' : 'All calendars have team members.') + ' Always verify reminder workflows are active.', stats: { total: calendars.length, withTeam: withTeam } };
}

function analyzeForms(forms, surveys) {
  var issues = [];
  if (forms.length + surveys.length === 0) {
    issues.push({ severity: 'critical', title: 'No forms created', detail: 'No forms or surveys exist. Lead capture, intake, and feedback collection is manual or nonexistent.', fix: 'Create at minimum: an intake/application form, a client onboarding form, and a feedback/NPS form.' });
    return { score: 0, issues: issues, expert: 'No forms means manual data collection -- a major efficiency gap.', stats: { forms: 0, surveys: 0 } };
  }
  if (surveys.length === 0) issues.push({ severity: 'suggestion', title: 'No surveys configured', detail: 'Surveys are useful for NPS, feedback collection, and lead qualification.', fix: 'Add at least one feedback survey to collect client satisfaction data post-service.' });
  issues.push({ severity: 'suggestion', title: 'Verify all forms are connected to workflows', detail: 'Forms are only valuable if submissions trigger an automation.', fix: 'For each form, confirm there is a workflow with Form Submitted as the trigger.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 40 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return { score: score, issues: issues, expert: forms.length + ' form(s) and ' + surveys.length + ' survey(s) found. Always confirm each form has a corresponding workflow trigger.', stats: { forms: forms.length, surveys: surveys.length } };
}

function analyzeSettings(location) {
  var issues = [];
  var emailOk = !!(location.email || location.businessEmail);
  var phoneOk = !!(location.phone);
  var tzOk = !!(location.timezone);
  var logoOk = !!(location.logoUrl);
  var addrOk = !!(location.address);
  if (!emailOk) issues.push({ severity: 'critical', title: 'No sender email address configured', detail: 'All outgoing emails will use a default address. This hurts deliverability and looks unprofessional.', fix: 'Go to Settings > Business Info > Email and add your verified sender email address.' });
  if (!phoneOk) issues.push({ severity: 'critical', title: 'No phone/SMS number configured', detail: 'SMS workflows cannot send messages without a configured phone number. All SMS automation is broken.', fix: 'Go to Settings > Phone Numbers and add or purchase a Twilio/LC Phone number for your location.' });
  if (!tzOk) issues.push({ severity: 'warning', title: 'No timezone configured', detail: 'Without a timezone, scheduled sends and appointments may fire at the wrong time.', fix: 'Set the correct timezone under Settings > Business Info.' });
  if (!logoOk) issues.push({ severity: 'suggestion', title: 'No logo uploaded', detail: 'Missing logo affects branding on emails, funnels, and the client portal.', fix: 'Upload your logo under Settings > Business Info.' });
  if (!addrOk) issues.push({ severity: 'suggestion', title: 'No business address on file', detail: 'A physical address is legally required in the footer of marketing emails (CAN-SPAM).', fix: 'Add your business address under Settings > Business Info.' });
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'critical'; }).length * 25 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 10 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return { score: score, issues: issues, expert: 'Email configured: ' + (emailOk ? 'Yes' : 'No (!)') + '. Phone configured: ' + (phoneOk ? 'Yes' : 'No (!)') + '. ' + (!emailOk || !phoneOk ? 'Missing communication settings will silently break automations.' : 'Core communication channels are set up.'), stats: { emailOk: emailOk, phoneOk: phoneOk, tzOk: tzOk, logoOk: logoOk, addrOk: addrOk } };
}

function analyzeCustomValues(customValues) {
  var issues = [];
  if (customValues.length === 0) {
    issues.push({ severity: 'warning', title: 'No custom values configured', detail: 'Custom values store reusable dynamic content used across all emails and workflows.', fix: 'Add key custom values: your business name, website URL, booking link, service price, and social media links.' });
  } else if (customValues.length < 5) {
    issues.push({ severity: 'suggestion', title: 'Few custom values', detail: 'A well-built account typically has 10-30 custom values for common business details.', fix: 'Expand your custom values to include booking links, pricing tiers, resource links, and team info.' });
  }
  var score = Math.max(0, 100 - issues.filter(function(i) { return i.severity === 'warning'; }).length * 15 - issues.filter(function(i) { return i.severity === 'suggestion'; }).length * 5);
  return { score: score, issues: issues, expert: customValues.length === 0 ? 'No custom values -- email personalization is limited to first name only.' : customValues.length + ' custom value(s) configured. Custom values are the data infrastructure for dynamic email and SMS content.', stats: { total: customValues.length } };
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

app.get('/version', function(req, res) { res.json({ version: VERSION }); });

app.post('/api/debug', async function(req, res) {
  var rawToken = String(req.body.token || '');
  var locationId = String(req.body.locationId || '').trim();
  var clean = '';
  for (var i = 0; i < rawToken.length; i++) {
    var code = rawToken.charCodeAt(i);
    if (code >= 32 && code <= 126) clean += rawToken[i];
  }
  clean = clean.trim();
  var info = {
    version: VERSION,
    rawLength: rawToken.length,
    cleanLength: clean.length,
    startsWithPit: clean.startsWith('pit-'),
    first10: clean.substring(0, 10),
    locationId: locationId,
    badChars: []
  };
  for (var j = 0; j < rawToken.length; j++) {
    var c = rawToken.charCodeAt(j);
    if (c < 32 || c > 126) info.badChars.push({ index: j, value: c });
  }
  try {
    var result = await ghlGet(rawToken, '/locations/' + locationId);
    info.ghlStatus = 'SUCCESS';
    info.locationName = (result.location || result).name || 'unknown';
  } catch (e) {
    info.ghlStatus = 'FAILED';
    info.ghlError = e.message;
  }
  res.json(info);
});;

app.post('/api/audit', async function(req, res) {
  var rawToken = String(req.body.token || '');
  var locationId = String(req.body.locationId || '').trim();

  if (!rawToken || !locationId) return res.status(400).json({ error: 'Token and Location ID are required.' });

  var results = {};
  var errors = {};

  try {
    var data = await ghlGet(rawToken, '/locations/' + locationId);
    var loc = data.location || data;
    results.settings = analyzeSettings(loc);
    results.settings.location = { name: loc.name, email: loc.email || loc.businessEmail, phone: loc.phone, timezone: loc.timezone, logoUrl: loc.logoUrl };
  } catch (e) {
    errors.settings = e.message;
    results.settings = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch location settings', detail: e.message, fix: 'Check that your token has locations.readonly scope.' }], expert: 'Could not fetch location settings.', stats: {} };
  }

  try {
    var data2 = await ghlGet(rawToken, '/contacts/?locationId=' + locationId + '&limit=100');
    results.contacts = analyzeContacts(data2.contacts || []);
  } catch (e) {
    errors.contacts = e.message;
    results.contacts = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch contacts', detail: e.message, fix: 'Ensure contacts.readonly scope is enabled.' }], expert: 'API error fetching contacts.', stats: { total: 0 } };
  }

  try {
    var pData = await ghlGet(rawToken, '/opportunities/pipelines/?locationId=' + locationId);
    var pipelines = pData.pipelines || [];
    var opportunities = [];
    try { var oData = await ghlGet(rawToken, '/opportunities/search/?location_id=' + locationId + '&limit=100'); opportunities = oData.opportunities || []; } catch (_) {}
    results.pipelines = analyzePipelines(pipelines, opportunities);
  } catch (e) {
    errors.pipelines = e.message;
    results.pipelines = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch pipelines', detail: e.message, fix: 'Ensure opportunities.readonly scope is enabled.' }], expert: 'API error fetching pipelines.', stats: { pipelines: 0, opportunities: 0, stale: 0 } };
  }

  try {
    var wData = await ghlGet(rawToken, '/workflows/?locationId=' + locationId);
    results.workflows = analyzeWorkflows(wData.workflows || []);
  } catch (e) {
    errors.workflows = e.message;
    results.workflows = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch workflows', detail: e.message, fix: 'Ensure workflows.readonly scope is enabled.' }], expert: 'API error fetching workflows.', stats: { total: 0, active: 0, draft: 0 } };
  }

  try {
    var cData = await ghlGet(rawToken, '/calendars/?locationId=' + locationId);
    results.calendars = analyzeCalendars(cData.calendars || []);
  } catch (e) {
    errors.calendars = e.message;
    results.calendars = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch calendars', detail: e.message, fix: 'Ensure calendars.readonly scope is enabled.' }], expert: 'API error fetching calendars.', stats: { total: 0, withTeam: 0 } };
  }

  try {
    var fData = await ghlGet(rawToken, '/forms/?locationId=' + locationId + '&limit=50');
    var surveys = [];
    try { var sData = await ghlGet(rawToken, '/surveys/?locationId=' + locationId + '&limit=50'); surveys = sData.surveys || []; } catch (_) {}
    results.forms = analyzeForms(fData.forms || [], surveys);
  } catch (e) {
    errors.forms = e.message;
    results.forms = { score: 0, issues: [{ severity: 'critical', title: 'Could not fetch forms', detail: e.message, fix: 'Ensure forms.readonly scope is enabled.' }], expert: 'API error fetching forms.', stats: { forms: 0, surveys: 0 } };
  }

  try {
    var cvData = await ghlGet(rawToken, '/locations/' + locationId + '/customValues');
    results.customValues = analyzeCustomValues(cvData.customValues || []);
  } catch (e) {
    errors.customValues = e.message;
    results.customValues = { score: 50, issues: [{ severity: 'suggestion', title: 'Could not fetch custom values', detail: e.message, fix: 'Ensure locations/customValues.readonly scope is enabled.' }], expert: 'Could not fetch custom values -- check API scopes.', stats: { total: 0 } };
  }

  try {
    var funData = await ghlGet(rawToken, '/funnels/?locationId=' + locationId + '&limit=50');
    var funnels = funData.funnels || [];
    var fIssues = [];
    if (funnels.length === 0) {
      fIssues.push({ severity: 'warning', title: 'No funnels or websites found', detail: 'No funnels or websites are set up.', fix: 'Build a lead capture funnel: opt-in page then thank you page then trigger a nurture workflow.' });
    }
    var fScore = funnels.length === 0 ? 30 : 85;
    results.funnels = { score: fScore, issues: fIssues, expert: funnels.length === 0 ? 'No funnels found -- every service business needs at minimum a lead capture page and a booking page.' : funnels.length + ' funnel/website(s) found.', stats: { total: funnels.length } };
  } catch (e) {
    errors.funnels = e.message;
    results.funnels = { score: 50, issues: [{ severity: 'warning', title: 'Funnels scope needed', detail: e.message, fix: 'Add funnels/funnel.readonly scope to your integration token.' }], expert: 'Funnels are your lead capture front door. Every service business needs at minimum: a lead magnet/opt-in page, a booking page, and a thank-you page with proper workflow triggers.', stats: { total: 0 } };
  }

  res.json({ version: VERSION, overallScore: buildOverallScore(results), sections: results, allIssues: buildAllIssues(results), errors: errors });
});

app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('GHL Expert Audit ' + VERSION + ' running on port ' + PORT); });
