import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, runTransaction, increment, arrayUnion, arrayRemove, deleteField, serverTimestamp, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';

const env = await initializeTestEnvironment({ projectId: 'hatim-test', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const ctx = (uid, extra = {}) => env.authenticatedContext(uid, { email: uid + '@x.com', email_verified: true, firebase: { sign_in_provider: 'password' }, ...extra }).firestore();
const A = ctx('A'), B = ctx('B'), C = ctx('C'), D = ctx('D');
const mk = () => { const d = new Date(); return 'm' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const days = n => Timestamp.fromDate(new Date(Date.now() + n * 86400000));
let ok = 0, bad = 0;
async function t(name, should, fn) {
  try { await (should ? assertSucceeds(fn()) : assertFails(fn())); ok++; console.log('OK   ', name); }
  catch (e) { bad++; console.log(`::error title=kural::${name} (${should ? 'izin verilmeliydi' : 'engellenmeliydi'}) ${String(e.message || e).slice(0, 200)}`); }
}

// Profiller
for (const [db, u] of [[A, 'A'], [B, 'B'], [C, 'C'], [D, 'D']]) await t(`profil ${u}`, true, () => setDoc(doc(db, 'users', u), { name: u, gender: 'erkek', createdAt: serverTimestamp() }, { merge: true }));
await t('sayaçla profil oluşturma (hile)', false, () => setDoc(doc(ctx('E'), 'users', 'E'), { name: 'E', gender: 'erkek', totalJuzRead: 999 }));

// Grup kurma (A)
const G = 'g1';
await t('grup kurma', true, () => {
  const b = writeBatch(A);
  b.set(doc(A, 'groups', G), { name: 'Cuma', description: '', code: 'ABC234', creatorId: 'A', creatorName: 'A', genderType: 'karma', durationDays: 7, status: 'toplaniyor', memberIds: ['A'], memberNames: { A: 'A' }, juzCounts: {}, takenCount: 0, doneCount: 0, hatimCount: 0, locked: false, joinRequests: {}, startAt: Timestamp.now(), endAt: days(7), createdAt: serverTimestamp() });
  for (let n = 1; n <= 30; n++) b.set(doc(A, 'juz', `${G}_${n}`), { number: n, groupId: G, groupName: 'Cuma', uid: null, userName: null, status: 'bos', endAt: null, volunteer: false, updatedAt: serverTimestamp() });
  b.set(doc(A, 'stats', 'global'), { groupsCreated: increment(1) }, { merge: true });
  return b.commit();
});

// Cüz alma (B)
async function take(db, uid, nums, endAt = days(7)) {
  return runTransaction(db, async tx => {
    await tx.get(doc(db, 'groups', G));
    for (const n of nums) { await tx.get(doc(db, 'juz', `${G}_${n}`)); }
    for (const n of nums) tx.update(doc(db, 'juz', `${G}_${n}`), { uid, userName: uid, status: 'alindi', takenAt: Timestamp.now(), endAt, volunteer: false, updatedAt: serverTimestamp() });
    tx.update(doc(db, 'groups', G), { takenCount: increment(nums.length), [`juzCounts.${uid}`]: increment(nums.length), memberIds: arrayUnion(uid), [`memberNames.${uid}`]: uid });
  });
}
await t('cüz alma (B: 1,2,3)', true, () => take(B, 'B', [1, 2, 3]));
await t('başkasının süresi dolmamış cüzünü kapma (C)', false, () => updateDoc(doc(C, 'juz', `${G}_1`), { uid: 'C', userName: 'C', status: 'alindi', volunteer: false, endAt: days(7) }));
await t('üyenin grup adını değiştirmesi', false, () => updateDoc(doc(B, 'groups', G), { name: 'Hack' }));
await t('cüz bırakma (B: 3)', true, () => runTransaction(B, async tx => {
  await tx.get(doc(B, 'groups', G)); await tx.get(doc(B, 'juz', `${G}_3`));
  tx.update(doc(B, 'juz', `${G}_3`), { uid: null, userName: null, status: 'bos', endAt: null, updatedAt: serverTimestamp() });
  tx.update(doc(B, 'groups', G), { takenCount: increment(-1), 'juzCounts.B': increment(-1) });
}));
await t('okumaya başlama (B: 1)', true, () => updateDoc(doc(B, 'juz', `${G}_1`), { status: 'okunuyor', updatedAt: serverTimestamp() }));
await t('okudum (B: 1)', true, () => runTransaction(B, async tx => {
  await tx.get(doc(B, 'groups', G)); await tx.get(doc(B, 'juz', `${G}_1`));
  tx.update(doc(B, 'juz', `${G}_1`), { status: 'okundu', doneAt: serverTimestamp(), updatedAt: serverTimestamp() });
  tx.update(doc(B, 'groups', G), { doneCount: increment(1) });
  tx.update(doc(B, 'users', 'B'), { totalJuzRead: increment(1), [`monthReads.${mk()}`]: increment(1), [`monthLast.${mk()}`]: serverTimestamp() });
  tx.set(doc(B, 'stats', 'global'), { juzRead: increment(1) }, { merge: true });
}));
await t('istatistiği 100 artırma (hile)', false, () => setDoc(doc(C, 'stats', 'global'), { juzRead: increment(100) }, { merge: true }));
await t('dua okundu işareti', true, () => setDoc(doc(B, 'users', 'B'), { duaRead: { [G]: 0 } }, { merge: true }));

// Süresi dolmuş cüzü yeniden alma (C)
await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), 'juz', `${G}_2`), { endAt: days(-1) }); });
await t('süresi dolmuş cüzü yeniden alma (C)', true, () => runTransaction(C, async tx => {
  await tx.get(doc(C, 'groups', G)); await tx.get(doc(C, 'juz', `${G}_2`));
  tx.update(doc(C, 'juz', `${G}_2`), { uid: 'C', userName: 'C', status: 'alindi', volunteer: true, previousUid: 'B', takenAt: Timestamp.now(), endAt: days(7), updatedAt: serverTimestamp() });
  tx.update(doc(C, 'groups', G), { 'juzCounts.B': increment(-1), 'juzCounts.C': increment(1), memberIds: arrayUnion('C'), 'memberNames.C': 'C' });
}));

// Katılma, ayrılma, kilit, istek
await t('gruba katılma (D)', true, () => updateDoc(doc(D, 'groups', G), { memberIds: arrayUnion('D'), 'memberNames.D': 'D', 'joinRequests.D': deleteField() }));
await t('başkasını gruptan çıkarma (D)', false, () => updateDoc(doc(D, 'groups', G), { memberIds: arrayRemove('B') }));
await t('gruptan ayrılma (D)', true, () => updateDoc(doc(D, 'groups', G), { memberIds: arrayRemove('D'), 'memberNames.D': deleteField() }));
await t('kilitleme (kurucu)', true, () => updateDoc(doc(A, 'groups', G), { locked: true }));
await t('kilitli gruba kendi katılma (D)', false, () => updateDoc(doc(D, 'groups', G), { memberIds: arrayUnion('D'), 'memberNames.D': 'D' }));
await t('katılma isteği (D)', true, () => updateDoc(doc(D, 'groups', G), { 'joinRequests.D': 'D' }));
await t('isteği kabul (kurucu)', true, () => updateDoc(doc(A, 'groups', G), { 'joinRequests.D': deleteField(), memberIds: arrayUnion('D'), 'memberNames.D': 'D' }));

// Davetler
await t('davet gönderme (üye B → X)', true, () => setDoc(doc(B, 'invites', `${G}_X`), { groupId: G, groupName: 'Cuma', fromUid: 'B', fromName: 'B', toUid: 'X', status: 'bekliyor', createdAt: serverTimestamp() }));
await t('aynı kişiye yeniden davet (üye C)', true, () => setDoc(doc(C, 'invites', `${G}_X`), { groupId: G, groupName: 'Cuma', fromUid: 'C', fromName: 'C', toUid: 'X', status: 'bekliyor', createdAt: serverTimestamp() }));
await t('üye olmayanın sahte adla daveti', false, () => setDoc(doc(ctx('Z'), 'invites', `${G}_Y`), { groupId: G, groupName: 'Bedava ödül!', fromUid: 'Z', fromName: 'Z', toUid: 'Y', status: 'bekliyor' }));
await t('daveti görüldü yapma (X)', true, () => updateDoc(doc(ctx('X'), 'invites', `${G}_X`), { status: 'goruldu' }));

// Arkadaşlık
await t('arkadaşlık isteği (B→C)', true, () => setDoc(doc(B, 'friendRequests', 'B_C'), { fromUid: 'B', fromName: 'B', toUid: 'C', toName: 'C', members: ['B', 'C'], status: 'bekliyor', createdAt: serverTimestamp() }));
await t('isteği kabul (C)', true, () => updateDoc(doc(C, 'friendRequests', 'B_C'), { status: 'kabul', respondedAt: serverTimestamp() }));
await t('kabul ederken üyeleri değiştirme (hile)', false, () => updateDoc(doc(C, 'friendRequests', 'B_C'), { status: 'kabul', members: ['B', 'C', 'Z'] }));

// Hatim tamamlanması ve yeniden açılması
await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), 'groups', G), { doneCount: 30, status: 'okunuyor' }); });
await t('hepsi okununca tamamlama (herkes)', true, () => runTransaction(D, async tx => {
  await tx.get(doc(D, 'groups', G));
  tx.update(doc(D, 'groups', G), { status: 'tamamlandi', hatimCount: increment(1), finishedAt: serverTimestamp() });
  tx.set(doc(D, 'stats', 'global'), { hatimsCompleted: increment(1) }, { merge: true });
}));
await t('yeni hatim (kurucu)', true, () => {
  const b = writeBatch(A);
  for (let n = 1; n <= 30; n++) b.update(doc(A, 'juz', `${G}_${n}`), { uid: null, userName: null, status: 'bos', endAt: null, volunteer: false, previousUid: null, updatedAt: serverTimestamp() });
  b.update(doc(A, 'groups', G), { prevReaders: ['A', 'B'], status: 'toplaniyor', takenCount: 0, doneCount: 0, juzCounts: {}, startAt: Timestamp.now(), endAt: days(7) });
  return b.commit();
});

// Hesap silme (C): toplanıyor grupta cüz bırakma + kayıt silme
await t('cüz alma (C: 5)', true, () => take(C, 'C', [5]));
await t('hesap silme: cüzü bırak (C)', true, () => {
  const b = writeBatch(C);
  b.update(doc(C, 'juz', `${G}_5`), { uid: null, userName: null, status: 'bos' });
  b.update(doc(C, 'groups', G), { takenCount: increment(-1), 'juzCounts.C': increment(-1), memberIds: arrayRemove('C'), 'memberNames.C': deleteField() });
  return b.commit();
});
await t('hesap silme: kullanıcı kaydı (C)', true, () => deleteDoc(doc(C, 'users', 'C')));
await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), 'users', 'D'), { blocked: true }); });
await t('engelli üyenin kaydını silmesi', false, () => deleteDoc(doc(D, 'users', 'D')));
await t('engelli üyenin cüz alması', false, () => take(D, 'D', [6]));
await t('yönetici engeli kaldırma', true, () => updateDoc(doc(env.authenticatedContext('adm', { email: 'sviapp.developer@gmail.com', email_verified: true }).firestore(), 'users', 'D'), { blocked: false }));

console.log(`\nSONUÇ: ${ok} geçti, ${bad} hatalı`);
console.log(`::notice title=sonuc::${ok} geçti, ${bad} hatalı`);
await env.cleanup();
process.exit(bad ? 1 : 0);
