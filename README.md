# Maslow Inventory Hub

Context:
Build a web-based inventory management system for Maslow. This replaces a manual, spreadsheet-based process. For reference, a related business (BDTH) currently tracks inventory in Google Sheets across three tabs — Stock In, Stock Out, and Daily Issuance — with daily manual entry per item. Use that as a structural reference, but build something more robust, automated, and error-resistant for Maslow.
Goal:
A clean, easy-to-use system that lets staff log stock movements daily, gives management real-time visibility into inventory levels, and eliminates the manual errors and scrolling-nightmare of spreadsheets.
CORE FEATURES
	1.	Dashboard
	•	Overview cards: total items, total stock value (if pricing is tracked), low-stock item count
	•	Recent activity feed (last 10 stock in/out entries)
	•	Low-stock alert list (items below reorder threshold, visually flagged)
	2.	Stock In
	•	Form to log incoming stock: item, quantity, date, supplier (optional), notes
	•	Auto-updates the item’s current balance
	•	History table, filterable by date/item
	3.	Stock Out / Daily Issuance
	•	Form to log outgoing stock: item, quantity, date, recipient/department, issued by
	•	Auto-deducts from current balance
	•	Prevents issuing more than available stock (validation)
	•	History table, filterable by date/item
	4.	Item Management
	•	Add/edit/delete items
	•	Fields: name, category, unit of measurement, reorder threshold, expiry date (optional)
	•	Category management (add/edit categories)
	5.	Reports
	•	Date-range filter
	•	Usage summary (total in vs. out per item)
	•	Most-issued items
	•	Export to CSV
	6.	User Roles & Auth
	•	Admin: full access — manage items, users, view all reports
	•	Staff: can log Stock In/Out only, no delete permissions
	•	Simple login (email + password)
DATA MODEL
Items
- id
- name
- category_id
- unit (e.g. packs, bottles, pieces)
- reorder_threshold
- expiry_date (nullable)
- current_balance (calculated or stored)
Categories
- id
- name
StockIn
- id
- item_id (FK)
- quantity
- date
- supplier (nullable)
- logged_by (FK -> Users)
StockOut
- id
- item_id (FK)
- quantity
- date
- recipient (nullable)
- logged_by (FK -> Users)
Users
- id
- name
- email
- password_hash
- role (admin | staff)
	1.	Low-stock visual alerts on dashboard
	2.	Expiry date tracking + alerts
	3.	Reports with date filters + CSV export
	4.	Email/SMS notifications for low stock
	5.	Audit log (who changed what, when)
	6.	CSV import (to migrate existing sheet data)
DESIGN NOTES
	•	Mobile-responsive — staff may log entries from phones
	•	Clean, minimal UI — avoid clutter, prioritize the daily-use forms (Stock In/Out) as the fastest, most frictionless part of the app
	•	Validation on all forms (no negative quantities, no issuing more than available stock)

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
