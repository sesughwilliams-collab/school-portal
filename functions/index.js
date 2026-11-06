const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

async function ensurePrincipal(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  }

  const userDoc = await admin.firestore().collection("users").doc(context.auth.uid).get();
  const role = userDoc.exists ? userDoc.data().role : null;

  if (role !== "principal") {
    throw new functions.https.HttpsError("permission-denied", "Only the principal can manage portal users.");
  }
}

async function deleteStudentLinkedData(uid, studentId) {
  const firestore = admin.firestore();

  const studentRef = firestore.collection("students").doc(uid);
  const studentDoc = await studentRef.get();
  if (studentDoc.exists) {
    await studentRef.delete();
  }

  const resultsQuery = await firestore.collection("results").where("uid", "==", uid).get();
  if (!resultsQuery.empty) {
    const batch = firestore.batch();
    resultsQuery.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  if (studentId) {
    const byStudentId = await firestore.collection("results").where("studentId", "==", studentId).get();
    if (!byStudentId.empty) {
      const batch = firestore.batch();
      byStudentId.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }
}

exports.activatePortalUser = functions.https.onCall(async (data, context) => {
  await ensurePrincipal(context);

  const role = data && data.role;
  const email = data && data.email;
  const password = data && data.password;

  if (!['teacher', 'student'].includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Choose a valid role.");
  }
  if (!email || !password) {
    throw new functions.https.HttpsError("invalid-argument", "Email and password are required.");
  }
  if (password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Use a password with at least 6 characters.");
  }

  const user = await admin.auth().createUser({
    email,
    password,
    emailVerified: false,
  });

  const docData = {
    role,
    email,
    createdBy: context.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (role === 'student') {
    const studentId = (data.studentId || '').trim();
    const name = (data.name || '').trim();
    const cls = (data.cls || '').trim();

    if (!studentId || !name || !cls) {
      await admin.auth().deleteUser(user.uid);
      throw new functions.https.HttpsError("invalid-argument", "Student name, student ID, and class are required.");
    }

    docData.studentId = studentId;
    await admin.firestore().collection("students").doc(user.uid).set({
      uid: user.uid,
      studentId,
      name,
      cls,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await admin.firestore().collection("users").doc(user.uid).set(docData);

  return {
    uid: user.uid,
    email: user.email,
    role,
  };
});

exports.deletePortalUser = functions.https.onCall(async (data, context) => {
  await ensurePrincipal(context);

  const uid = data && data.uid;
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "A user ID is required.");
  }

  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  const role = userDoc.exists ? userDoc.data().role : null;
  if (!role || !['teacher', 'student'].includes(role)) {
    throw new functions.https.HttpsError("not-found", "That user does not exist in the portal.");
  }

  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("failed-precondition", "The principal cannot delete their own account from the portal.");
  }

  const studentId = userDoc.data().studentId || null;

  await deleteStudentLinkedData(uid, studentId);
  await admin.firestore().collection("users").doc(uid).delete();

  try {
    await admin.auth().deleteUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return { ok: true, uid, role };
});
