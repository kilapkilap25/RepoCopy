# EMR System Capstone — Consolidated Revision Notes

## Changes

1. **Visible validation notifications**
   - Fixed toast notifications to use the application's actual `toast-container` element, with a fallback container when needed.
   - Toast messages use text content and alert/status roles so validation errors are visible and accessible.
   - Fixed a pre-existing JavaScript syntax error in the session unlock error handler.

2. **Patient registration and profile editing**
   - Added required-field validation for last name, first name, birthdate, sex, and address.
   - Missing fields receive inline errors, an on-screen warning, and focus.
   - Future birthdates are rejected in the UI and API.
   - Backend profile updates reject missing required values and invalid/future birthdates.

3. **Immunization records**
   - Date Given is read-only in the browser and set to the current Philippine local date when the form opens and submits.
   - The backend sets Date Given itself, so a modified client request cannot change it.
   - Next Schedule cannot be earlier than Date Given/today, enforced in both the UI and backend.
   - Vaccine name and dose number are validated.

4. **Doctor diagnosis and prescriptions**
   - Doctor submissions require visit date, symptoms, diagnosis, and treatment.
   - Future visit dates are rejected in the UI.
   - Before saving a doctor's diagnosis, the frontend checks the total requested quantity for each selected item against available stock.
   - The backend exposes an availability check that accounts for stock reserved by pending prescriptions.
   - The prescription creation API independently rejects quantities exceeding available stock.
   - Insufficient stock blocks the diagnosis form before the record is saved, and the prescription cannot enter the nurse dispensing queue.

5. **Other forms**
   - Added required metadata to staff registration, staff editing, and profile fields that already have save-time validation.
   - Existing validation flows on disease, account, password, and inventory forms benefit from the corrected visible notification system.

## Validation performed

- Python source files passed `compileall` syntax compilation.
- Inline JavaScript in patients, dashboard, and inventory pages passed `node --check`.
- External frontend JavaScript passed `node --check` after fixing the session script syntax error.
- Static checks confirmed the key validation and stock-check paths are present.

## Still required in the deployment environment

A live application/database test was not run in this environment because the backend import is missing the `slowapi` dependency. Install the project's backend requirements, configure the database, then test the acceptance cases from the project handoff before using this system with real patient records.
