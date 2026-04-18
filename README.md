# GHL Sub-Account Audit Tool

A full health check tool for GoHighLevel sub-accounts. Audits all major sections and generates a downloadable PDF report.

## What it audits
- Contacts & CRM
- Pipelines & Opportunities
- Funnels & Websites
- Automations & Workflows
- Calendars & Appointments
- Forms & Surveys
- Email/SMS Settings
- Integrations & Custom Values

## Tech Stack
- Node.js + Express (backend)
- Vanilla HTML/CSS/JS (frontend)
- jsPDF (PDF generation)

## Local Setup

1. Clone the repo
   ```bash
   git clone https://github.com/YOUR_USERNAME/ghl-audit-tool.git
   cd ghl-audit-tool
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Create your `.env` file
   ```bash
   PORT=3000
   ```

4. Start the server
   ```bash
   node server.js
   ```

5. Open browser at `http://localhost:3000`

## Deploy on Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) and sign up with GitHub
3. Click **New +** → **Web Service**
4. Select this repo
5. Set:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: Free
6. Click **Deploy**

## Required GHL Token Scopes
- contacts.readonly
- opportunities.readonly
- funnels.readonly
- workflows.readonly
- calendars.readonly
- forms.readonly
- locations.readonly
- custom-values.readonly
