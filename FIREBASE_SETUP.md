# Firebase setup and test guide

## Which email to use

There is no default email or password in this portal. For a test account, use an email inbox you control and create a Firebase Authentication user for it. Never send the password to anyone or put it in this file. You can use the same test email for a teacher or principal profile; the Firestore role document controls access.

## Configure the Firebase project

1. In Firebase Console, open **Authentication > Sign-in method** and enable **Email/Password**.
2. Under **Authentication > Settings > Authorized domains**, ensure `localhost` and your eventual website domain are listed.
3. Create a **Firestore Database** if one does not exist.
	This Firebase project already has a database with ID `user` in region `nam5`; the app is configured to use that named database.
4. Open **Firestore Database > Rules**, replace the rules with `firestore.rules`, and publish them.
5. Create a test user under **Authentication > Users > Add user** using an inbox you can access. Copy that user's UID. The first attempted sign-in sends the email verification message; verify the address, then sign in again.
6. In Firestore, create `users/{AUTH_UID}` where `{AUTH_UID}` is exactly the UID shown in Authentication. For a principal, set `{ "role": "principal" }`; for a teacher, set `{ "role": "teacher" }`.
7. Open `http://localhost:8000`, choose **Staff**, and sign in with that email and password. Add student records with the **Firebase Auth UID** of each student's account.

To test the password reset, enter the same registered email in the portal's **Forgot password?** form. Firebase sends a reset link to that address. The UI intentionally shows a generic confirmation so it does not disclose whether an email is registered.

## Set up a student test account

1. Add a second Firebase Authentication account using a guardian email inbox you control. The guardian receives verification and password-reset links for that student account.
2. Create `users/{STUDENT_AUTH_UID}` with `{ "role": "student", "studentId": "GFC/TEST/001" }`.
3. While signed in as staff, add the matching student ID, name, class, and exact Auth UID in the Students tab.
4. Enter and save a result, submit the class as teacher, and publish it as principal. Then sign in using the guardian email and the student's password; the student can query only their own published result documents.

## Firestore data layout

- `users/{authUid}` stores the administrator-provisioned role and student ID. Clients can read only their own role document and cannot create or edit roles.
- `students/{authUid}` stores the student ID, Auth UID, name, and class. Staff can manage records; a student can read only the record linked to their UID.
- `results/{encodedTerm|session|studentId}` stores one student's scores for one term, plus student UID, class, and publication status. Students can read only their own published records.
- `classStatuses/{encodedTerm|session|class}` stores the teacher/principal workflow state.
- `settings/portal` stores the active term and session. Only a principal can change it.

The rules enforce these boundaries in Firestore, not just in the UI. Do not loosen them to `allow read, write: if true`. Firestore may ask you to create an index if its console reports a missing index; follow the Firebase error link to create the requested index.

## Important production checks

This moves the app data from browser/local storage into Firestore with role-based access, but this is not yet a complete production release. The owner must publish and test the rules in the actual Firebase project, confirm email delivery and recovery templates, restrict the API key to the deployed domains, migrate/enter data deliberately, and test with separate teacher, principal, and student accounts. Review privacy, retention, backups, audit requirements, and applicable student-data laws before selling or using real records. The project still uses a static client app; sensitive administrative workflows may warrant a trusted server/Cloud Functions layer and audit logging.
