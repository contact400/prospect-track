import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentUser = null;
let currentUserProfile = null;
let isAdmin = false;
let allProspects = [];
let allUsers = [];
let exportMode = false;
let selectedMLS = new Set();
let unsubscribeProspects = null;
let unsubscribeTargets = null;
let unsubscribeOpsListings = null;
let unsubscribeOpsPurchases = null;
let todaysTargets = [];
let activeFilters = { sort: "newest", mailing: "all", visit: "all", eval: "all", type: "all" };
let selectedMunicipalities = new Set();
let dupReviewMode = false;

// ── Ops state ──────────────────────────────────────────────
let opsListings = [];
let opsPurchases = [];
let opsView = "dash"; // "dash" | "listings" | "purchases"
let opsActiveLid = null;
let opsActivePid = null;
let opsListingView = "checklist"; // "checklist" | "conditions" | "offers" | "activity"
let opsActivityCache = {}; // lid -> array of activity docs
let unsubscribeActivity = {};

// ── Bonus structures ───────────────────────────────────────
const BONUS_STRUCTURES = {
  "benjamin": { tiers: [{ doors:120, sale:33, purchase:25, label:"Tier 1" },{ doors:170, sale:45, purchase:35, label:"Tier 2" }] },
  "afshin":   { tiers: [{ doors:100, sale:55, purchase:35, label:"Tier 1" },{ doors:150, sale:70, purchase:50, label:"Tier 2" }] },
  "default":  { tiers: [{ doors:100, sale:33, purchase:25, label:"Tier 1" },{ doors:150, sale:45, purchase:35, label:"Tier 2" }] }
};
function getBonusStructure(name) {
  if (!name) return BONUS_STRUCTURES.default;
  const key = name.toLowerCase().split(" ")[0];
  return BONUS_STRUCTURES[key] || BONUS_STRUCTURES.default;
}

// ── SOP Phases ─────────────────────────────────────────────
const OPS_PHASES = [
  {id:"p1",label:"Phase 1 — Rencontre → Affichage",color:"#1D9E75",tasks:[
    {id:"t101",name:"Évaluation bookée",who:"Karim",tool:"Téléphone / FUB",time:"Dès réception",det:"Qualifier le lead : motivation, échéancier, projet d'achat parallèle. Booker le rendez-vous d'évaluation."},
    {id:"t102",name:"Deal ajouté dans FUB, Track et Numbers Sheet",who:"Sara",tool:"FUB / Track / Numbers",time:"Dès que booké",det:"Créer la fiche dans FUB, ajouter le dossier dans Track et mettre à jour le Numbers Sheet avec les informations du vendeur."},
    {id:"t103",name:"TEMPLATE TEXT — Courriel de confirmation avec témoignages et Guide",who:"Sara",tool:"Gmail / FUB",time:"Dans les 24h",det:"Envoyer le courriel de confirmation du rendez-vous avec les témoignages clients et le guide vendeur BACHA."},
    {id:"t104",name:"Préparation du contrat de courtage et de la déclaration du vendeur",who:"Sara",tool:"EZmax",time:"La veille du RV",det:"Préparer le contrat de courtage et la déclaration du vendeur dans EZmax. Vérifier que tous les champs sont prêts à être remplis."},
    {id:"t105",name:"TEMPLATE PDF AI — Préparation de l'éval",who:"Karim",tool:"AI / PDF Template",time:"La veille du RV",det:"Utiliser le template PDF AI pour préparer le dossier d'évaluation : CMA, comparables, stratégie de mise en marché."},
    {id:"t106",name:"Confirmation du rendez-vous le matin même de l'évaluation",who:"Karim",tool:"Téléphone / SMS",time:"Matin du RV",det:"Appeler ou texter le vendeur pour confirmer le rendez-vous. S'assurer que la propriété est accessible."},
    {id:"t107",name:"Évaluation, signature du contrat & book photographe",who:"Karim",tool:"En personne / EZmax",time:"Lors du RV",det:"Faire la visite complète, présenter le CMA, signer le contrat de courtage et la déclaration du vendeur. Booker le photographe."},
    {id:"t108",name:"TEMPLATE TEXT — Créer groupe WhatsApp et envoyer message d'introduction",who:"Sara",tool:"WhatsApp",time:"Après signature",det:"Créer le groupe WhatsApp avec le vendeur, Karim et Sara. Envoyer le message d'introduction BACHA."},
    {id:"t109",name:"TEMPLATE TEXT — Courriel détaillant les prochaines étapes (photo, affichage, visite libre)",who:"Sara",tool:"Gmail / FUB",time:"Après signature",det:"Envoyer le courriel qui détaille les prochaines étapes : séance photo, date d'affichage prévue et visite libre."},
    {id:"t110",name:"Sécuriser certificat de localisation et taxes municipales et scolaires",who:"Sara",tool:"Notaire / Ville",time:"Dans les 48h",det:"Obtenir le certificat de localisation (vérifier s'il est à jour) et les taxes municipales et scolaires pour Centris."},
    {id:"t111",name:"TEMPLATE TEXT — Courriel détaillant les prochaines étapes avec les dates",who:"Sara",tool:"Gmail / FUB",time:"Dès que dates confirmées",det:"Envoyer le courriel final avec toutes les dates confirmées : photo, affichage, visite libre."},
    {id:"t112",name:"Préparer recherche automatisée pour le secteur de la propriété",who:"Karim",tool:"Matrix Centris",time:"Avant affichage",det:"Configurer une alerte automatisée sur Matrix pour identifier les acheteurs potentiels dans le secteur."},
    {id:"t113",name:"Suite à la réception des photos — Préparation du listing et des publications Instagram (story, post, vidéo)",who:"Sara / Benjamin",tool:"Centris / Canva / Meta",time:"Dès réception des photos",det:"Préparer et publier le listing sur Centris. Créer les publications Instagram : story, post et vidéo de la propriété."},
    {id:"t114",name:"TEMPLATE CANVA — Préparation et commande des flyers (distribution locale & visites libres)",who:"Sara / Benjamin",tool:"Canva / Imprimeur",time:"Avant affichage",det:"Préparer les flyers avec le template Canva et les envoyer à l'impression pour la distribution locale et les visites libres."},
  ]},
  {id:"p2",label:"Phase 2 — Affichage à la présentation d'offre",color:"#378ADD",tasks:[
    {id:"t201",name:"(JOUR 1) Affichage de la propriété et installation de pancarte",who:"Karim / Benjamin",tool:"Kit pancarte BACHA",time:"Jour du listing",det:"Activer le listing sur Centris. Installer la pancarte BACHA devant la propriété. Prendre une photo de confirmation."},
    {id:"t202",name:"Envoyer message WhatsApp aux vendeurs pour leur montrer l'annonce",who:"Sara",tool:"WhatsApp",time:"Jour du listing",det:"Envoyer le lien Centris aux vendeurs via le groupe WhatsApp. Leur montrer à quoi ressemble leur annonce en ligne."},
    {id:"t203",name:"(JOUR 2) TEMPLATE PDF AI — Envoyer les compteurs Matrix",who:"Karim",tool:"Matrix / AI Template",time:"Jour 2 du listing",det:"Utiliser le template AI pour envoyer un rapport des compteurs Matrix aux vendeurs : vues, favoris, comparaisons."},
    {id:"t204",name:"Préparer le dossier de visite libre (chevalet & flyers)",who:"Sara / Benjamin",tool:"Imprimés BACHA",time:"Avant la visite libre",det:"Préparer le chevalet BACHA, les flyers et tout le matériel nécessaire pour la visite libre."},
    {id:"t205",name:"Visite libre — Installation du chevalet 20 minutes d'avance",who:"Karim / Benjamin",tool:"Chevalet BACHA",time:"20 min avant visite libre",det:"Arriver 20 minutes avant le début de la visite libre pour installer le chevalet et préparer la propriété."},
    {id:"t206",name:"Effectuer la visite libre",who:"Karim / Benjamin / Afshin",tool:"En personne",time:"Durant la visite libre",det:"Accueillir les visiteurs, présenter la propriété, répondre aux questions et collecter les coordonnées des prospects."},
    {id:"t207",name:"(Chaque dimanche) TEMPLATE PDF AI — Envoyer le weekly report",who:"Karim",tool:"AI Template / Gmail",time:"Chaque dimanche",det:"Envoyer le rapport hebdomadaire aux vendeurs via le template AI : marketing, résultats de visites libres, updates du marché et direction de l'annonce."},
    {id:"t208",name:"TEMPLATE TEXT — Avis Immocontact envoyé suite à la visite libre",who:"Sara",tool:"Immocontact",time:"Après chaque visite libre",det:"Envoyer l'avis de suivi Immocontact à tous les courtiers qui ont visité la propriété."},
    {id:"t209",name:"Lundi suivant la visite libre — Appel systématique des leads & update vendeur",who:"Karim",tool:"Téléphone / FUB",time:"Lundi après visite libre",det:"Appeler tous les leads générés par la visite libre. Faire un update complet au vendeur sur les résultats."},
    {id:"t210",name:"(Jour 21) Booker un RDV de suivi par vidéoconférence avec les vendeurs",who:"Karim",tool:"Zoom / Google Meet",time:"Jour 21 du listing",det:"Organiser un suivi par vidéoconférence pour discuter de ce qui s'est bien passé, ce qui devrait être ajusté et la direction de l'annonce."},
  ]},
  {id:"p3",label:"Phase 3 — Réception et présentation d'offres",color:"#BA7517",tasks:[
    {id:"t301",name:"TEMPLATE TEXT — Avis Immocontact pour aviser la réception de l'offre d'achat",who:"Sara",tool:"Immocontact",time:"Dès réception de l'offre",det:"Envoyer l'avis Immocontact au courtier acheteur pour accuser réception de la promesse d'achat."},
    {id:"t302",name:"Aviser les vendeurs de la réception d'une promesse d'achat et confirmer l'heure de présentation",who:"Karim",tool:"WhatsApp / Téléphone",time:"Dès réception de l'offre",det:"Informer les vendeurs via WhatsApp qu'une promesse d'achat a été reçue. Confirmer l'heure et le mode de présentation (appel, vidéoconférence ou présentiel)."},
    {id:"t303",name:"TEMPLATE PDF AI — Préparer le tableau des offres",who:"Karim",tool:"AI Template / PDF",time:"Avant la présentation",det:"Utiliser le template AI pour préparer le tableau comparatif des offres si plusieurs offres sont reçues."},
    {id:"t304",name:"Présentation de l'offre ou des offres aux vendeurs",who:"Karim",tool:"En personne / Vidéoconférence",time:"À l'heure confirmée",det:"Présenter l'offre ou les offres aux vendeurs en détail. Analyser les clauses, le prix, le dépôt, les conditions et recommander une stratégie."},
  ]},
  {id:"p4",label:"Phase 4 — Acceptation d'une offre d'achat",color:"#534AB7",tasks:[
    {id:"t401",name:"TEMPLATE TEXT — Envoi d'avis Immocontact",who:"Sara",tool:"Immocontact",time:"Dès l'acceptation",det:"Envoyer l'avis Immocontact au courtier acheteur pour confirmer l'acceptation de la promesse d'achat."},
    {id:"t402",name:"Mettre à jour Track avec les informations nécessaires",who:"Sara",tool:"Track app",time:"Le jour même",det:"Mettre à jour le dossier dans Track : prix accepté, conditions, dates limites, date de possession."},
    {id:"t403",name:"Faire les suivis nécessaires en fonction de Track",who:"Karim / Sara",tool:"Track app",time:"En continu",det:"Suivre les conditions et les délais tels qu'indiqués dans Track. Effectuer les relances et actions requises à chaque étape."},
  ]},
  {id:"p5",label:"Phase 5 — Réalisation des conditions",color:"#0F6E56",tasks:[
    {id:"t501",name:"Suivi des délais de conditions",who:"Sara",tool:"Track app / Calendrier",time:"Quotidiennement",det:"Vérifier quotidiennement les dates limites de chaque condition. Envoyer des rappels 48h avant chaque échéance."},
    {id:"t502",name:"Rappel courtier acheteur toutes les 4 jours",who:"Karim",tool:"Téléphone / courriel",time:"Toutes les 4 jours",det:"Contacter le courtier acheteur pour suivre l'avancement de chaque condition. Documenter tous les contacts."},
    {id:"t503",name:"Coordination de l'inspection préachat",who:"Sara",tool:"Téléphone / Immocontact",time:"Dans les 3 jours",det:"Confirmer l'inspecteur, la date et l'heure avec les deux parties."},
    {id:"t504",name:"Révision du rapport d'inspection",who:"Karim",tool:"Courriel / en personne",time:"Dans les 24h du rapport",det:"Analyser les déficiences soulevées. Conseiller les vendeurs sur la stratégie à adopter."},
    {id:"t505",name:"Confirmation de l'approbation du financement",who:"Karim",tool:"Téléphone / courriel",time:"Avant la date limite",det:"Exiger une confirmation écrite de l'institution financière avant la date limite de la condition."},
    {id:"t506",name:"Obtention de la levée des conditions",who:"Karim",tool:"EZmax / DocuSign",time:"À la date limite",det:"S'assurer que les deux parties signent la levée des conditions. La transaction est maintenant ferme."},
    {id:"t507",name:"Transmission des documents au notaire",who:"Sara",tool:"Courriel / portail notaire",time:"Dès l'offre ferme",det:"Envoyer au notaire : acte de vente, DV, certificat de localisation, promesse d'achat et levée des conditions."},
    {id:"t508",name:"Communication continue avec le vendeur",who:"Karim",tool:"Téléphone / WhatsApp",time:"En continu",det:"Tenir le vendeur informé à chaque étape. Éviter les silences prolongés."},
  ]},
  {id:"p6",label:"Phase 6 — Préparation au notaire",color:"#633806",tasks:[
    {id:"t601",name:"Confirmation de la date du rendez-vous notarié",who:"Sara",tool:"Téléphone / courriel",time:"3–5 jours avant",det:"Confirmer la date et l'heure avec le notaire ET le vendeur. Ajouter au calendrier."},
    {id:"t602",name:"Rappel final au client",who:"Karim / Sara",tool:"Téléphone / SMS",time:"2–3 jours avant",det:"Rappeler au vendeur d'apporter ses pièces d'identité et confirmer sa disponibilité."},
    {id:"t603",name:"Rappel annulation / transfert des services",who:"Sara",tool:"Courriel / SMS",time:"1 semaine avant",det:"Rappeler au vendeur de s'occuper du transfert des services : assurance, Hydro-Québec, Énergir, taxes."},
    {id:"t604",name:"Préparer le relevé de commission",who:"Sara",tool:"Track app / Excel",time:"1 semaine avant",det:"Calculer la commission brute, les partages et les primes BACHA. Préparer le relevé final."},
  ]},
  {id:"p7",label:"Phase 7 — Après la vente",color:"#3C3489",tasks:[
    {id:"t701",name:"Suivi lors de la signature chez le notaire",who:"Karim",tool:"En personne / téléphone",time:"Jour de signature",det:"Présence recommandée chez le notaire. Excellente opportunité pour obtenir des références."},
    {id:"t702",name:"Fermeture administrative dans FUB et Track",who:"Sara",tool:"FUB / Track app",time:"Jour de signature",det:"Mettre le statut à Vendu dans FUB et Track. Archiver le prix final, la commission et l'agent responsable."},
    {id:"t703",name:"Remise des clés",who:"Karim / Benjamin / Afshin",tool:"En personne",time:"Jour de possession",det:"Remettre les clés, télécommandes et codes d'accès à l'acheteur. Confirmer la libération de la propriété."},
    {id:"t704",name:"Envoi cadeau / mot de remerciement",who:"Karim",tool:"Cadeau / carte manuscrite",time:"Dans les 3 jours",det:"Budget 50–150$. Un geste apprécié qui génère des références."},
    {id:"t705",name:"Demande d'avis Google",who:"Karim",tool:"SMS / courriel",time:"3–5 jours après",det:"Envoyer le lien direct Google Review. Relancer une fois si nécessaire."},
    {id:"t706",name:"Suivi post-transaction",who:"Karim",tool:"Téléphone / WhatsApp",time:"2–4 semaines après",det:"Appel de suivi : déménagement ok? Projet d'achat en vue? Demander des références."},
    {id:"t707",name:"Ajouter à la liste de nurture long terme",who:"Sara",tool:"FUB / Mailchimp",time:"Dans la semaine",det:"Étiqueter le contact comme client passé dans FUB et l'ajouter aux campagnes de nurture annuelles."},
  ]},
];

const OPS_ALL_TASKS = OPS_PHASES.flatMap(p => p.tasks);
const OPS_STATUS_LABELS = {active:"Actif",offre:"Offre reçue",ferme:"Vente ferme",vendu:"Vendu"};
const OPS_STATUS_COLORS = {active:"#1D9E75",offre:"#185FA5",ferme:"#534AB7",vendu:"#888780"};
const OPS_PURCHASE_STATUS_LABELS = {active:"Actif",offre:"Offre acceptée",cond:"Conditions réalisées",notarie:"Notarié"};
const OPS_PURCHASE_STATUS_COLORS = {active:"#888780",offre:"#185FA5",cond:"#1D9E75",notarie:"#534AB7"};
const OPS_PURCHASE_SOLD = ["cond","notarie"];


// ── Helpers ────────────────────────────────────────────────
function detectPropertyType(address) {
  if (!address) return "house";
  const a = address.toLowerCase();
  if (/\bapp\.?\s*\d|#\s*\d|\bapt\.?\s*\d|, app |, apt |bureau\s*\d|suite\s*\d|unit\s*\d|\bunité\s*\d/.test(a)) return "condo";
  return "house";
}
function extractMunicipality(address) {
  if (!address) return "Unknown";
  const match = address.match(/\(([^)]+)\)/);
  if (match) return match[1].trim();
  return "Unknown";
}
function getMunicipalities() {
  const set = new Set(allProspects.map(p => extractMunicipality(p.listingAddress)));
  return [...set].filter(m => m && m !== "Unknown").sort();
}
function findDuplicateMLS() {
  const seen = {}; const dups = new Set();
  allProspects.forEach(p => { if (seen[p.mls]) dups.add(p.mls); else seen[p.mls] = true; });
  return dups;
}
function getDupProspects() { const d = findDuplicateMLS(); return allProspects.filter(p => d.has(p.mls)); }
function getDupGroups() {
  const dupMLS = findDuplicateMLS(); const groups = {};
  allProspects.forEach(p => { if (dupMLS.has(p.mls)) { if (!groups[p.mls]) groups[p.mls]=[]; groups[p.mls].push(p); } });
  Object.values(groups).forEach(g => g.sort((a,b) => { const ta=a.createdAt?.toMillis?a.createdAt.toMillis():0; const tb=b.createdAt?.toMillis?b.createdAt.toMillis():0; return ta-tb; }));
  return groups;
}
function getTodayKey() { return new Date().toISOString().slice(0,10); }
function getMonthKey(date) { const d=date||new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function getVisitsForAgent(agentId, monthKey) {
  let count=0; let evals=0;
  allProspects.forEach(p => { (p.visits||[]).forEach(v => { if (v.agentId!==agentId) return; if (!v.date) return; const vM=v.date.slice(0,7); if (monthKey&&vM!==monthKey) return; count++; if (v.evalBooked==="yes") evals++; }); });
  return {doors:count,evals};
}
function getMonthlyHistory(agentId) {
  const months = {};
  allProspects.forEach(p => { (p.visits||[]).forEach(v => { if (v.agentId!==agentId||!v.date) return; const mk=v.date.slice(0,7); if (!months[mk]) months[mk]={doors:0,evals:0}; months[mk].doors++; if (v.evalBooked==="yes") months[mk].evals++; }); });
  return Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0]));
}

// ── Ops helpers ────────────────────────────────────────────
function opsCanAccess(doc) {
  if (isAdmin) return true;
  return (doc.assignedTo || []).includes(currentUser.uid);
}
function opsParsePx(s) { if (!s) return 0; const n = s.replace(/[^0-9]/g,""); return n ? parseInt(n) : 0; }
function opsFmtPx(n) { if (!n) return "—"; return Number(n).toLocaleString("fr-CA")+" $"; }
function opsDaysUntil(ds) { if (!ds) return null; const t=new Date(); t.setHours(0,0,0,0); const d=new Date(ds); d.setHours(0,0,0,0); return Math.round((d-t)/86400000); }
function opsCondInfo(c) {
  if (c.done) return {cls:"ops-cb-done",txt:"Levée",urg:false};
  if (!c.date) return {cls:"ops-cb-none",txt:"Sans date",urg:false};
  const d = opsDaysUntil(c.date);
  if (d<0) return {cls:"ops-cb-urg",txt:"Expirée",urg:true};
  if (d<=3) return {cls:"ops-cb-urg ops-pulse",txt:d===0?"Auj.":d+"j",urg:true};
  if (d<=7) return {cls:"ops-cb-warn",txt:d+"j restants",urg:false};
  return {cls:"ops-cb-ok",txt:d+"j restants",urg:false};
}
function opsFmtDate(ds) { if (!ds) return "—"; const [y,m,dd]=ds.slice(0,10).split("-").map(Number); const dt=new Date(y,m-1,dd); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"short"}); }
function opsHasUrg(conds) { return (conds||[]).some(c=>!c.done&&c.date&&opsDaysUntil(c.date)<=3&&opsDaysUntil(c.date)>=0); }
function opsLProg(l) { const tot=OPS_ALL_TASKS.length; const dn=OPS_ALL_TASKS.filter(t=>(l.checklist||{})[t.id]).length; return {tot,dn,pct:tot?Math.round(dn/tot*100):0}; }
function opsPProg(p) { const c=p.conditions||[]; return {tot:c.length,dn:c.filter(x=>x.done).length,pct:c.length?Math.round(c.filter(x=>x.done).length/c.length*100):0}; }

// ── Auth ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) { currentUser=user; await loadUserProfile(user.uid); showApp(); }
  else { currentUser=null; currentUserProfile=null; isAdmin=false; todaysTargets=[]; showLogin(); }
});
async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db,"users",uid));
  if (snap.exists()) { currentUserProfile={uid,...snap.data()}; isAdmin=currentUserProfile.role==="admin"; }
}
window.handleLogin = async function() {
  const email=document.getElementById("loginEmail").value.trim();
  const password=document.getElementById("loginPassword").value;
  const btn=document.getElementById("loginBtn"); const err=document.getElementById("loginError");
  err.style.display="none"; btn.textContent="Signing in..."; btn.disabled=true;
  try { await signInWithEmailAndPassword(auth,email,password); }
  catch(e) { err.textContent="Invalid email or password."; err.style.display="block"; btn.textContent="Sign in"; btn.disabled=false; }
};
window.handleLogout = async function() {
  if (unsubscribeProspects) unsubscribeProspects();
  if (unsubscribeTargets) unsubscribeTargets();
  if (unsubscribeOpsListings) unsubscribeOpsListings();
  if (unsubscribeOpsPurchases) unsubscribeOpsPurchases();
  await signOut(auth);
};
function showLogin() {
  document.getElementById("loginScreen").classList.add("active");
  document.getElementById("appScreen").classList.remove("active");
  document.getElementById("loginEmail").value="";
  document.getElementById("loginPassword").value="";
}
function showApp() {
  document.getElementById("loginScreen").classList.remove("active");
  document.getElementById("appScreen").classList.add("active");
  setupRoleUI(); subscribeToProspects(); subscribeToTargets(); subscribeToOps();
  if (isAdmin) { loadAllUsers(); renderDashboard(); }
}
function setupRoleUI() {
  const name=currentUserProfile?.name||currentUser.email;
  const role=isAdmin?"Admin":"Agent";
  document.getElementById("userPill").textContent=`${name} · ${role}`;
  document.getElementById("mobileUserPill").textContent=`${name} · ${role}`;
  if (isAdmin) {
    document.getElementById("dashNav").style.display="";
    document.getElementById("adminNav").style.display="";
    document.getElementById("dashNavMobile").style.display="";
    document.getElementById("adminNavMobile").style.display="";
    document.getElementById("addProspectBtn").style.display="";
  }
  // Ops nav always shown (access controlled per-dossier)
  document.getElementById("opsNav").style.display="";
  document.getElementById("opsNavMobile").style.display="";
}

window.switchView = function(name, el) {
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  if (el) document.querySelectorAll(`[data-view="${name}"]`).forEach(n=>n.classList.add("active"));
  document.getElementById("mobileTitle").textContent =
    name==="prospects"?"Prospects":name==="dashboard"?"Dashboard":name==="targets"?"Today's Targets":name==="performance"?"My Performance":name==="ops"?"BACHA Ops":"Admin";
  if (name==="dashboard") renderDashboard();
  if (name==="admin") renderAdmin();
  if (name==="targets") renderTargetsView();
  if (name==="performance") renderPerformanceView();
  if (name==="ops") renderOps();
};
window.toggleMobileNav = function() { const d=document.getElementById("mobileDrawer"); d.style.display=d.style.display==="block"?"none":"block"; };
window.closeMobileNav = function() { document.getElementById("mobileDrawer").style.display="none"; };

// ── Ops Firestore subscriptions ────────────────────────────
function subscribeToOps() {
  const lq = query(collection(db,"ops_listings"), orderBy("createdAt","desc"));
  unsubscribeOpsListings = onSnapshot(lq, snap => {
    opsListings = snap.docs.map(d=>({id:d.id,...d.data()})).filter(opsCanAccess);
    if (document.getElementById("view-ops").classList.contains("active")) renderOps();
  });
  const pq = query(collection(db,"ops_purchases"), orderBy("createdAt","desc"));
  unsubscribeOpsPurchases = onSnapshot(pq, snap => {
    opsPurchases = snap.docs.map(d=>({id:d.id,...d.data()})).filter(opsCanAccess);
    if (document.getElementById("view-ops").classList.contains("active")) renderOps();
  });
}

// ── Ops CRUD ───────────────────────────────────────────────
window.opsOpenNewListing = function() {
  const agents = allUsers.length ? allUsers : [{uid:currentUser.uid,name:currentUserProfile?.name||"Karim"}];
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Nouvelle inscription</div><button class="close-x" onclick="closeAllModals()">×</button></div>
    <div class="mbody-ops">
      <div class="form-group"><label>Adresse</label><input type="text" id="om-addr" placeholder="123 rue des Érables, Laval"></div>
      <div class="form-group"><label>Vendeur</label><input type="text" id="om-seller" placeholder="Nom du vendeur"></div>
      <div class="form-group"><label>Prix demandé</label><input type="text" id="om-price" placeholder="ex: 549 000 $"></div>
      <div class="form-group"><label>Courtier responsable</label>
        <select id="om-agent"><option value="Karim">Karim</option><option value="Benjamin">Benjamin</option><option value="Afshin">Afshin</option></select></div>
      <div class="form-group"><label>Statut</label>
        <select id="om-status"><option value="active">Actif</option><option value="offre">Offre reçue</option><option value="ferme">Vente ferme</option><option value="vendu">Vendu</option></select></div>
      ${isAdmin ? `<div class="form-group"><label>Accès agents</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
          ${agents.map(u=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" value="${u.uid}" class="ops-assign-cb" checked> ${u.name||u.email}</label>`).join("")}
        </div></div>` : ""}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsSaveListing()">Enregistrer</button>
    </div>`;
  openModal("opsModal");
};

window.opsSaveListing = async function(editId) {
  const addr = document.getElementById("om-addr").value.trim();
  if (!addr) return;
  const assignedTo = isAdmin
    ? [...document.querySelectorAll(".ops-assign-cb:checked")].map(cb=>cb.value)
    : [currentUser.uid];
  const data = {
    addr, seller: document.getElementById("om-seller").value.trim(),
    price: document.getElementById("om-price").value.trim(),
    agent: document.getElementById("om-agent").value,
    status: document.getElementById("om-status").value,
    assignedTo, checklist:{}, conditions:[],
    updatedAt: serverTimestamp()
  };
  if (editId) { await updateDoc(doc(db,"ops_listings",editId),data); }
  else { data.createdAt=serverTimestamp(); data.createdBy=currentUser.uid; const ref=await addDoc(collection(db,"ops_listings"),data); opsActiveLid=ref.id; }
  closeAllModals(); opsView="listings";
};

window.opsOpenNewPurchase = function(editId) {
  const existing = editId ? opsPurchases.find(x=>x.id===editId) : null;
  const g = f => existing?.[f]||"";
  const gc = f => existing?.conditions?.[f]||"";
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">${existing?"Modifier l'achat":"Nouvel achat"}</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div class="mbody-ops" style="max-height:65vh;overflow-y:auto;padding-right:4px;">

      <div class="ops-offer-section-title">Identification</div>
      <div class="form-group"><label>Adresse de la propriété</label><input type="text" id="om-addr" placeholder="456 boul. des Laurentides, Laval" value="${g("addr")}"></div>
      <div class="form-group"><label>Nom de l'acheteur</label><input type="text" id="om-buyer" placeholder="ex: Jean Tremblay" value="${g("buyer")}"></div>
      <div class="form-group"><label>Courtier vendeur (partie adverse)</label><input type="text" id="om-seller-agent" placeholder="ex: Marie Dupont — Remax" value="${g("sellerAgent")}"></div>
      <div class="form-group"><label>Prix d'offre ($)</label><input type="text" id="om-price" placeholder="ex: 489 000 $" value="${g("price")}" style="font-size:15px;font-weight:500;"></div>
      <div class="form-group"><label>Validité de l'offre</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="date" id="om-validity-date" value="${g("validityDate")}" style="flex:1;">
          <input type="time" id="om-validity-time" value="${g("validityTime")||"17:00"}" style="width:110px;">
        </div>
      </div>
      <div class="form-group"><label>Courtier BACHA responsable</label>
        <select id="om-agent">
          <option value="Karim"${g("agent")==="Karim"?" selected":""}>Karim</option>
          <option value="Benjamin"${g("agent")==="Benjamin"?" selected":""}>Benjamin</option>
          <option value="Afshin"${g("agent")==="Afshin"?" selected":""}>Afshin</option>
        </select>
      </div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Conditions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Inspection (jours)</label><input type="number" id="om-insp" placeholder="ex: 10" min="0" value="${gc("inspection")}"></div>
        <div class="form-group"><label>Financement (jours)</label><input type="number" id="om-fin" placeholder="ex: 15" min="0" value="${gc("financing")}"></div>
        <div class="form-group"><label>Revue de documents (jours)</label><input type="number" id="om-docs" placeholder="ex: 5" min="0" value="${gc("docReview")}"></div>
        <div class="form-group"><label>Autre condition (jours)</label><input type="number" id="om-other" placeholder="ex: 7" min="0" value="${gc("other")}"></div>
      </div>
      <div class="form-group"><label>Documents requis pour la revue</label><textarea id="om-doclist" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${gc("docList")}</textarea></div>
      <div class="form-group"><label>Autre condition — détails</label><textarea id="om-otherdet" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${gc("otherDetails")}</textarea></div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Dates & occupation</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Date du notaire souhaitée</label><input type="date" id="om-notary" value="${g("notaryDate")}"></div>
        <div class="form-group"><label>Date d'occupation souhaitée</label><input type="date" id="om-occupancy" value="${g("occupancyDate")}"></div>
      </div>
      <div class="form-group"><label>Loyer si délai entre notaire et occupation?</label>
        <select id="om-rent" onchange="document.getElementById('om-rentdet-wrap').style.display=this.value==='oui'?'block':'none'">
          <option value="">— Sélectionner —</option>
          <option value="non"${g("rent")==="non"?" selected":""}>Non</option>
          <option value="oui"${g("rent")==="oui"?" selected":""}>Oui</option>
        </select>
      </div>
      <div id="om-rentdet-wrap" style="display:${g("rent")==="oui"?"block":"none"}">
        <div class="form-group"><label>Détails du loyer</label><textarea id="om-rentdet" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${g("rentDetails")}</textarea></div>
      </div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Inclusions & exclusions</div>
      <div class="form-group"><label>Inclusions</label><textarea id="om-incl" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${g("inclusions")}</textarea></div>
      <div class="form-group"><label>Exclusions</label><textarea id="om-excl" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${g("exclusions")}</textarea></div>

      ${isAdmin ? `<div class="ops-offer-section-title" style="margin-top:1.25rem;">Accès agents</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${(allUsers.length?allUsers:[{uid:currentUser.uid,name:currentUserProfile?.name||"Karim"}]).map(u=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" value="${u.uid}" class="ops-assign-cb" ${!existing||((existing.assignedTo||[]).includes(u.uid))?"checked":""}> ${u.name||u.email}</label>`).join("")}
        </div>` : ""}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsSavePurchase('${editId||""}')">Enregistrer</button>
    </div>`;
  openModal("opsModal");
};

window.opsSavePurchase = async function(editId) {
  const g = id => document.getElementById(id)?.value?.trim()||"";
  const addr = g("om-addr");
  if (!addr) { showToast("Adresse requise"); return; }

  const rawPrice = g("om-price").replace(/[^0-9]/g,"");
  const fmtPrice = rawPrice ? Number(rawPrice).toLocaleString("fr-CA")+" $" : g("om-price");

  const vDate = g("om-validity-date");
  const vTime = document.getElementById("om-validity-time")?.value||"";
  const validityDisplay = vDate ? (() => { const [y,m,d]=vDate.split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"})+(vTime?" à "+vTime:""); })() : "";

  const assignedTo = isAdmin
    ? [...document.querySelectorAll(".ops-assign-cb:checked")].map(cb=>cb.value)
    : [currentUser.uid];

  const conditions = {
    inspection: g("om-insp"), financing: g("om-fin"),
    docReview: g("om-docs"), other: g("om-other"),
    docList: g("om-doclist"), otherDetails: g("om-otherdet"),
  };

  // Calculate deadlines from today
  const base = new Date();
  const localBase = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const addDays = n => { const d=new Date(localBase); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const deadlines = {};
  if (conditions.inspection) deadlines.inspection = addDays(parseInt(conditions.inspection));
  if (conditions.financing)  deadlines.financing  = addDays(parseInt(conditions.financing));
  if (conditions.docReview)  deadlines.docReview  = addDays(parseInt(conditions.docReview));
  if (conditions.other)      deadlines.other      = addDays(parseInt(conditions.other));

  // Build conditions array for the tracker
  const existing = editId ? (opsPurchases.find(x=>x.id===editId)?.conditions||[]).filter(c=>!c.fromOffer) : [];
  const autoConds = [];
  if (deadlines.financing)  autoConds.push({id:"ac_fin",  name:"Financement",       date:deadlines.financing,  done:false, fromOffer:true});
  if (deadlines.inspection) autoConds.push({id:"ac_insp", name:"Inspection",         date:deadlines.inspection, done:false, fromOffer:true});
  if (deadlines.docReview)  autoConds.push({id:"ac_doc",  name:"Revue de documents", date:deadlines.docReview,  done:false, fromOffer:true});
  if (deadlines.other)      autoConds.push({id:"ac_oth",  name:conditions.otherDetails||"Autre condition", date:deadlines.other, done:false, fromOffer:true});

  const data = {
    addr, buyer: g("om-buyer"), sellerAgent: g("om-seller-agent"),
    price: fmtPrice, agent: g("om-agent"),
    validityDate: vDate, validityTime: vTime, validity: validityDisplay,
    conditions: [...autoConds, ...existing],
    offerConditions: conditions, deadlines,
    notaryDate: g("om-notary"), occupancyDate: g("om-occupancy"),
    rent: g("om-rent"), rentDetails: g("om-rentdet"),
    inclusions: g("om-incl"), exclusions: g("om-excl"),
    status: "active", assignedTo,
    updatedAt: serverTimestamp()
  };

  if (editId) {
    await updateDoc(doc(db,"ops_purchases",editId),data);
  } else {
    data.createdAt=serverTimestamp(); data.createdBy=currentUser.uid;
    const ref=await addDoc(collection(db,"ops_purchases"),data);
    opsActivePid=ref.id;
  }
  closeAllModals(); opsView="purchases";
  showToast(editId?"Achat mis à jour ✓":"Achat enregistré ✓");
};

window.opsToggleTask = async function(lid, tid) {
  const l = opsListings.find(x=>x.id===lid);
  if (!l) return;
  const chk = {...(l.checklist||{})};
  chk[tid] = !chk[tid];
  await updateDoc(doc(db,"ops_listings",lid),{checklist:chk,updatedAt:serverTimestamp()});
};

window.opsAddCond = async function(type, eid, name, date) {
  const col = type==="l"?"ops_listings":"ops_purchases";
  const rec = type==="l"?opsListings.find(x=>x.id===eid):opsPurchases.find(x=>x.id===eid);
  if (!rec) return;
  const conds = [...(rec.conditions||[]), {id:"c"+Date.now(), name, date, done:false}];
  await updateDoc(doc(db,col,eid),{conditions:conds,updatedAt:serverTimestamp()});
};

window.opsToggleCond = async function(type, eid, cid) {
  const col = type==="l"?"ops_listings":"ops_purchases";
  const rec = type==="l"?opsListings.find(x=>x.id===eid):opsPurchases.find(x=>x.id===eid);
  if (!rec) return;
  const conds = (rec.conditions||[]).map(c=>c.id===cid?{...c,done:!c.done}:c);
  const update = {conditions:conds, updatedAt:serverTimestamp()};
  // For purchases: if all conditions are now done, auto-advance to "conditions réalisées"
  if (type==="p") {
    const allDone = conds.length > 0 && conds.every(c=>c.done);
    if (allDone && (rec.status==="offre"||rec.status==="active")) {
      update.status = "cond";
      showToast("Toutes les conditions réalisées — statut mis à jour ✓");
    }
  }
  // For listings: if all conditions are now done, auto-advance to "vente ferme"
  if (type==="l") {
    const allDone = conds.length > 0 && conds.every(c=>c.done);
    if (allDone && rec.status==="offre") {
      update.status = "ferme";
      showToast("Toutes les conditions réalisées — Vente ferme ✓");
    }
  }
  await updateDoc(doc(db,col,eid),update);
};

window.opsUpdateCondDate = async function(type, eid, cid, val) {
  const col = type==="l"?"ops_listings":"ops_purchases";
  const rec = type==="l"?opsListings.find(x=>x.id===eid):opsPurchases.find(x=>x.id===eid);
  if (!rec) return;
  const conds = (rec.conditions||[]).map(c=>c.id===cid?{...c,date:val}:c);
  await updateDoc(doc(db,col,eid),{conditions:conds,updatedAt:serverTimestamp()});
};

window.opsDelCond = async function(type, eid, cid) {
  const col = type==="l"?"ops_listings":"ops_purchases";
  const rec = type==="l"?opsListings.find(x=>x.id===eid):opsPurchases.find(x=>x.id===eid);
  if (!rec) return;
  const conds = (rec.conditions||[]).filter(c=>c.id!==cid);
  await updateDoc(doc(db,col,eid),{conditions:conds,updatedAt:serverTimestamp()});
};

window.opsChgStatus = async function(lid, val) {
  await updateDoc(doc(db,"ops_listings",lid),{status:val,updatedAt:serverTimestamp()});
};


window.opsUpdateListingPrice = async function(lid, field, val) {
  const update = {updatedAt:serverTimestamp()};
  update[field] = val;
  await updateDoc(doc(db,"ops_listings",lid),update);
};

// ── Offer management ────────────────────────────────────────
window.opsOpenNewOffer = function(lid) {
  const l = opsListings.find(x=>x.id===lid);
  if (!l) return;
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">Nouvelle offre reçue</div>
      <div class="modal-sub">${l.addr}</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div class="mbody-ops" style="max-height:65vh;overflow-y:auto;padding-right:4px;">
      <div class="ops-offer-section-title">Identification</div>
      <div class="form-group"><label>Nom de l'acheteur</label><input type="text" id="of-buyer" placeholder="ex: Jean Tremblay"></div>
      <div class="form-group"><label>Courtier représentant</label><input type="text" id="of-agent" placeholder="ex: Marie Dupont — Remax"></div>
      <div class="form-group"><label>Prix offert ($)</label><input type="text" id="of-price" placeholder="ex: 1 050 000 $" style="font-size:15px;font-weight:500;"></div>
      <div class="form-group"><label>Validité de l'offre</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="date" id="of-validity-date" style="flex:1;">
          <input type="time" id="of-validity-time" value="17:00" style="width:110px;">
        </div>
      </div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Conditions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Inspection (jours)</label><input type="number" id="of-insp" placeholder="ex: 10" min="0"></div>
        <div class="form-group"><label>Financement (jours)</label><input type="number" id="of-fin" placeholder="ex: 15" min="0"></div>
        <div class="form-group"><label>Revue de documents (jours)</label><input type="number" id="of-docs" placeholder="ex: 5" min="0"></div>
        <div class="form-group"><label>Autre condition (jours)</label><input type="number" id="of-other" placeholder="ex: 7" min="0"></div>
      </div>
      <div class="form-group"><label>Documents requis pour la revue</label><textarea id="of-doclist" rows="2" placeholder="ex: Déclarations du vendeur, procès-verbaux de copropriété..." style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;"></textarea></div>
      <div class="form-group"><label>Autre condition — détails</label><textarea id="of-otherdet" rows="2" placeholder="ex: Vente de la propriété actuelle de l'acheteur..." style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;"></textarea></div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Dates & occupation</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Date du notaire souhaitée</label><input type="date" id="of-notary"></div>
        <div class="form-group"><label>Date d'occupation souhaitée</label><input type="date" id="of-occupancy"></div>
      </div>
      <div class="form-group"><label>Loyer si délai entre notaire et occupation?</label>
        <select id="of-rent" onchange="document.getElementById('of-rentdet-wrap').style.display=this.value==='oui'?'block':'none'">
          <option value="">— Sélectionner —</option>
          <option value="non">Non</option>
          <option value="oui">Oui</option>
        </select>
      </div>
      <div id="of-rentdet-wrap" style="display:none;">
        <div class="form-group"><label>Détails du loyer</label><textarea id="of-rentdet" rows="2" placeholder="ex: 75$/jour à compter du notaire jusqu'à l'occupation" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;"></textarea></div>
      </div>

      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Inclusions & exclusions</div>
      <div class="form-group"><label>Inclusions</label><textarea id="of-incl" rows="2" placeholder="ex: Électroménagers, luminaires, stores..." style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;"></textarea></div>
      <div class="form-group"><label>Exclusions</label><textarea id="of-excl" rows="2" placeholder="ex: Lustre de la salle à manger, miroir entrée..." style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsSaveOffer('${lid}')">Enregistrer l'offre</button>
    </div>`;
  openModal("opsModal");
};

window.opsSaveOffer = async function(lid) {
  const g = id => document.getElementById(id)?.value?.trim();
  if (!g("of-buyer") && !g("of-agent")) { showToast("Veuillez entrer le nom de l'acheteur ou du courtier"); return; }
  const vDate = g("of-validity-date"); const vTime = document.getElementById("of-validity-time")?.value||"";
  const validityDisplay = vDate ? (() => { const [y,m,d]=vDate.split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"})+(vTime?" à "+vTime:""); })() : "";
  const rawPrice = g("of-price").replace(/[^0-9]/g,"");
  const fmtPrice = rawPrice ? Number(rawPrice).toLocaleString("fr-CA")+" $" : g("of-price");
  const offer = {
    id: "o" + Date.now(),
    buyer: g("of-buyer"), agent: g("of-agent"),
    price: fmtPrice, validityDate: vDate, validityTime: vTime, validity: validityDisplay,
    conditions: {
      inspection: g("of-insp")||"", financing: g("of-fin")||"",
      docReview: g("of-docs")||"", other: g("of-other")||"",
      docList: g("of-doclist"), otherDetails: g("of-otherdet"),
    },
    notaryDate: g("of-notary"), occupancyDate: g("of-occupancy"),
    rent: g("of-rent"), rentDetails: g("of-rentdet"),
    inclusions: g("of-incl"), exclusions: g("of-excl"),
    status: "pending", // pending | accepted | second | refused
    receivedAt: new Date().toISOString(),
    acceptedAt: null,
    deadlines: {},
  };
  const l = opsListings.find(x=>x.id===lid);
  const offers = [...(l.offers||[]), offer];
  await updateDoc(doc(db,"ops_listings",lid),{offers, status:"offre", updatedAt:serverTimestamp()});
  closeAllModals();
  showToast("Offre enregistrée ✓");
};

window.opsAcceptOffer = async function(lid, oid) {
  const l = opsListings.find(x=>x.id===lid);
  if (!l) return;
  const acceptedAt = new Date().toISOString();
  const base = new Date(acceptedAt);

  // Use local date string to avoid UTC offset shifting the base date
  const localToday = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const addDays = (n) => { const d=new Date(localToday); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

  const offers = (l.offers||[]).map(o=>{
    if (o.id !== oid) return o;
    const deadlines = {};
    if (o.conditions.inspection) deadlines.inspection = addDays(parseInt(o.conditions.inspection));
    if (o.conditions.financing)  deadlines.financing  = addDays(parseInt(o.conditions.financing));
    if (o.conditions.docReview)  deadlines.docReview  = addDays(parseInt(o.conditions.docReview));
    if (o.conditions.other)      deadlines.other      = addDays(parseInt(o.conditions.other));
    return {...o, status:"accepted", acceptedAt, deadlines};
  });

  const accepted = offers.find(o=>o.id===oid);
  const dl = accepted.deadlines || {};

  // Auto-populate the conditions array from accepted offer deadlines
  const autoConditions = [];
  if (dl.financing)  autoConditions.push({id:"ac_fin",  name:"Financement",         date:dl.financing,  done:false, fromOffer:true});
  if (dl.inspection) autoConditions.push({id:"ac_insp", name:"Inspection",           date:dl.inspection, done:false, fromOffer:true});
  if (dl.docReview)  autoConditions.push({id:"ac_doc",  name:"Revue de documents",   date:dl.docReview,  done:false, fromOffer:true});
  if (dl.other)      autoConditions.push({id:"ac_oth",  name:accepted.conditions.otherDetails||"Autre condition", date:dl.other, done:false, fromOffer:true});

  // Merge: keep any manually added conditions that are NOT fromOffer, replace fromOffer ones
  const existing = (l.conditions||[]).filter(c=>!c.fromOffer);
  const mergedConditions = [...autoConditions, ...existing];

  await updateDoc(doc(db,"ops_listings",lid),{
    offers,
    conditions: mergedConditions,
    offerPrice: accepted.price,
    notaryDate: accepted.notaryDate || l.notaryDate || "",
    status: "offre",
    updatedAt: serverTimestamp()
  });
  closeAllModals();
  showToast("Offre acceptée — conditions et délais mis à jour ✓");
};

window.opsSetOfferStatus = async function(lid, oid, status) {
  const l = opsListings.find(x=>x.id===lid);
  if (!l) return;
  const offers = (l.offers||[]).map(o=>o.id===oid?{...o,status}:o);
  await updateDoc(doc(db,"ops_listings",lid),{offers,updatedAt:serverTimestamp()});
  showToast(status==="second"?"Offre mise en 2e rang ✓":"Offre refusée");
};

window.opsEditOffer = function(lid, oid) {
  const l = opsListings.find(x=>x.id===lid);
  const o = (l?.offers||[]).find(x=>x.id===oid);
  if (!l||!o) return;
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">Modifier l'offre</div>
      <div class="modal-sub">${o.buyer||o.agent||"Offre"}</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div class="mbody-ops" style="max-height:65vh;overflow-y:auto;padding-right:4px;">
      <div class="ops-offer-section-title">Identification</div>
      <div class="form-group"><label>Nom de l'acheteur</label><input type="text" id="of-buyer" value="${o.buyer||""}" placeholder="ex: Jean Tremblay"></div>
      <div class="form-group"><label>Courtier représentant</label><input type="text" id="of-agent" value="${o.agent||""}" placeholder="ex: Marie Dupont — Remax"></div>
      <div class="form-group"><label>Prix offert ($)</label><input type="text" id="of-price" value="${o.price||""}" style="font-size:15px;font-weight:500;"></div>
      <div class="form-group"><label>Validité de l'offre</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="date" id="of-validity-date" value="${o.validityDate||""}" style="flex:1;">
          <input type="time" id="of-validity-time" value="${o.validityTime||"17:00"}" style="width:110px;">
        </div>
      </div>
      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Conditions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Inspection (jours)</label><input type="number" id="of-insp" value="${o.conditions?.inspection||""}" min="0"></div>
        <div class="form-group"><label>Financement (jours)</label><input type="number" id="of-fin" value="${o.conditions?.financing||""}" min="0"></div>
        <div class="form-group"><label>Revue de documents (jours)</label><input type="number" id="of-docs" value="${o.conditions?.docReview||""}" min="0"></div>
        <div class="form-group"><label>Autre condition (jours)</label><input type="number" id="of-other" value="${o.conditions?.other||""}" min="0"></div>
      </div>
      <div class="form-group"><label>Documents requis pour la revue</label><textarea id="of-doclist" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${o.conditions?.docList||""}</textarea></div>
      <div class="form-group"><label>Autre condition — détails</label><textarea id="of-otherdet" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${o.conditions?.otherDetails||""}</textarea></div>
      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Dates & occupation</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Date du notaire souhaitée</label><input type="date" id="of-notary" value="${o.notaryDate||""}"></div>
        <div class="form-group"><label>Date d'occupation souhaitée</label><input type="date" id="of-occupancy" value="${o.occupancyDate||""}"></div>
      </div>
      <div class="form-group"><label>Loyer si délai entre notaire et occupation?</label>
        <select id="of-rent" onchange="document.getElementById('of-rentdet-wrap').style.display=this.value==='oui'?'block':'none'">
          <option value="">— Sélectionner —</option>
          <option value="non"${o.rent==="non"?" selected":""}>Non</option>
          <option value="oui"${o.rent==="oui"?" selected":""}>Oui</option>
        </select>
      </div>
      <div id="of-rentdet-wrap" style="display:${o.rent==='oui'?'block':'none'}">
        <div class="form-group"><label>Détails du loyer</label><textarea id="of-rentdet" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${o.rentDetails||""}</textarea></div>
      </div>
      <div class="ops-offer-section-title" style="margin-top:1.25rem;">Inclusions & exclusions</div>
      <div class="form-group"><label>Inclusions</label><textarea id="of-incl" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${o.inclusions||""}</textarea></div>
      <div class="form-group"><label>Exclusions</label><textarea id="of-excl" rows="2" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${o.exclusions||""}</textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsUpdateOffer('${lid}','${oid}')">Enregistrer</button>
    </div>`;
  openModal("opsModal");
};

window.opsUpdateOffer = async function(lid, oid) {
  const g = id => document.getElementById(id)?.value?.trim();
  const l = opsListings.find(x=>x.id===lid);
  const vDate2 = g("of-validity-date"); const vTime2 = document.getElementById("of-validity-time")?.value||"";
  const validityDisplay2 = vDate2 ? (() => { const [y,m,d]=vDate2.split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"})+(vTime2?" à "+vTime2:""); })() : "";
  const rawPrice2 = g("of-price").replace(/[^0-9]/g,"");
  const fmtPrice2 = rawPrice2 ? Number(rawPrice2).toLocaleString("fr-CA")+" $" : g("of-price");
  const offers = (l.offers||[]).map(o=>{
    if (o.id!==oid) return o;
    const updated = {...o,
      buyer:g("of-buyer"), agent:g("of-agent"),
      price:fmtPrice2, validityDate:vDate2, validityTime:vTime2, validity:validityDisplay2,
      conditions:{
        inspection:g("of-insp")||"", financing:g("of-fin")||"",
        docReview:g("of-docs")||"", other:g("of-other")||"",
        docList:g("of-doclist"), otherDetails:g("of-otherdet"),
      },
      notaryDate:g("of-notary"), occupancyDate:g("of-occupancy"),
      rent:g("of-rent"), rentDetails:g("of-rentdet"),
      inclusions:g("of-incl"), exclusions:g("of-excl"),
    };
    // Recalculate deadlines if already accepted
    if (o.status==="accepted"&&o.acceptedAt) {
      const base=new Date(o.acceptedAt);
      const localBase=new Date(base.getFullYear(),base.getMonth(),base.getDate());
      const addD=(n)=>{const d=new Date(localBase);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
      const deadlines={};
      if (updated.conditions.inspection) deadlines.inspection=addD(parseInt(updated.conditions.inspection));
      if (updated.conditions.financing)  deadlines.financing=addD(parseInt(updated.conditions.financing));
      if (updated.conditions.docReview)  deadlines.docReview=addD(parseInt(updated.conditions.docReview));
      if (updated.conditions.other)      deadlines.other=addD(parseInt(updated.conditions.other));
      updated.deadlines=deadlines;
    }
    return updated;
  });

  // Re-sync auto conditions if the accepted offer was updated
  const acceptedOffer = offers.find(o=>o.status==="accepted");
  let updatePayload = {offers, updatedAt:serverTimestamp()};
  if (acceptedOffer && acceptedOffer.deadlines) {
    const dl = acceptedOffer.deadlines;
    const l = opsListings.find(x=>x.id===lid);
    const autoConditions = [];
    if (dl.financing)  autoConditions.push({id:"ac_fin",  name:"Financement",       date:dl.financing,  done:(l.conditions||[]).find(c=>c.id==="ac_fin")?.done||false,  fromOffer:true});
    if (dl.inspection) autoConditions.push({id:"ac_insp", name:"Inspection",         date:dl.inspection, done:(l.conditions||[]).find(c=>c.id==="ac_insp")?.done||false, fromOffer:true});
    if (dl.docReview)  autoConditions.push({id:"ac_doc",  name:"Revue de documents", date:dl.docReview,  done:(l.conditions||[]).find(c=>c.id==="ac_doc")?.done||false,  fromOffer:true});
    if (dl.other)      autoConditions.push({id:"ac_oth",  name:acceptedOffer.conditions.otherDetails||"Autre condition", date:dl.other, done:(l.conditions||[]).find(c=>c.id==="ac_oth")?.done||false, fromOffer:true});
    const existing = (l.conditions||[]).filter(c=>!c.fromOffer);
    updatePayload.conditions = [...autoConditions, ...existing];
  }

  await updateDoc(doc(db,"ops_listings",lid), updatePayload);
  closeAllModals();
  showToast("Offre mise à jour ✓");
};

window.opsDeleteOffer = async function(lid, oid) {
  if (!confirm("Supprimer cette offre?")) return;
  const l = opsListings.find(x=>x.id===lid);
  const offers = (l.offers||[]).filter(o=>o.id!==oid);
  const hasActive = offers.some(o=>o.status==="accepted"||o.status==="pending"||o.status==="second");
  const newStatus = hasActive?"offre":"active";
  await updateDoc(doc(db,"ops_listings",lid),{offers,status:newStatus,updatedAt:serverTimestamp()});
  showToast("Offre supprimée");
};

window.opsGenerateOfferPDF = function(lid, oid) {
  const l = opsListings.find(x=>x.id===lid);
  const o = (l?.offers||[]).find(x=>x.id===oid);
  if (!l||!o) return;
  const fmtDate = ds => { if(!ds) return "—"; const [y,m,d]=ds.slice(0,10).split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"}); };
  const fmtDeadline = (ds,days) => { if(!ds&&!days) return "—"; if(ds) return fmtDate(ds)+(days?` (${days}j)`:""); return `${days} jours à compter de l'acceptation`; };
  const statusLabels={pending:"En attente",accepted:"Acceptée",second:"2e rang",refused:"Refusée"};
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Résumé d'offre — ${l.addr}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;margin:40px;line-height:1.6;}
    h1{font-size:20px;color:#0C2B5E;margin-bottom:4px;}
    .sub{font-size:13px;color:#666;margin-bottom:24px;}
    .section{margin-bottom:20px;}
    .section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0C2B5E;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:10px;}
    .row{display:flex;gap:16px;margin-bottom:6px;}
    .field{flex:1;}
    .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.04em;}
    .val{font-size:14px;font-weight:500;color:#1a1a1a;}
    .price{font-size:22px;font-weight:700;color:#0C2B5E;}
    .badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;background:#E1F5EE;color:#085041;}
    .footer{margin-top:40px;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:12px;}
    table{width:100%;border-collapse:collapse;}
    td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;}
    td:first-child{color:#888;width:200px;}
    td:last-child{font-weight:500;}
  </style></head><body>
  <h1>BACHA Groupe Immobilier</h1>
  <div class="sub">Résumé d'offre d'achat — généré le ${fmtDate(new Date().toISOString())}</div>
  <div class="section">
    <div class="section-title">Propriété</div>
    <div class="val" style="font-size:16px;">${l.addr}</div>
    ${l.price?`<div style="color:#666;font-size:13px;">Prix inscrit : ${l.price}</div>`:""}
  </div>
  <div class="section">
    <div class="section-title">Offre</div>
    <table>
      <tr><td>Acheteur</td><td>${o.buyer||"—"}</td></tr>
      <tr><td>Courtier représentant</td><td>${o.agent||"—"}</td></tr>
      <tr><td>Prix offert</td><td class="price">${o.price||"—"}</td></tr>
      <tr><td>Validité de l'offre</td><td>${o.validity||"—"}</td></tr>
      <tr><td>Statut</td><td><span class="badge">${statusLabels[o.status]||"—"}</span></td></tr>
      ${o.acceptedAt?`<tr><td>Date d'acceptation</td><td>${fmtDate(o.acceptedAt)}</td></tr>`:""}
    </table>
  </div>
  <div class="section">
    <div class="section-title">Conditions</div>
    <table>
      ${o.conditions?.inspection?`<tr><td>Inspection</td><td>${fmtDeadline(o.deadlines?.inspection,o.conditions.inspection)}</td></tr>`:""}
      ${o.conditions?.financing?`<tr><td>Financement</td><td>${fmtDeadline(o.deadlines?.financing,o.conditions.financing)}</td></tr>`:""}
      ${o.conditions?.docReview?`<tr><td>Revue de documents</td><td>${fmtDeadline(o.deadlines?.docReview,o.conditions.docReview)}${o.conditions.docList?`<br><span style="font-size:12px;color:#666;">Documents : ${o.conditions.docList}</span>`:""}</td></tr>`:""}
      ${o.conditions?.other?`<tr><td>Autre condition</td><td>${fmtDeadline(o.deadlines?.other,o.conditions.other)}${o.conditions.otherDetails?`<br><span style="font-size:12px;color:#666;">${o.conditions.otherDetails}</span>`:""}</td></tr>`:""}
      ${!o.conditions?.inspection&&!o.conditions?.financing&&!o.conditions?.docReview&&!o.conditions?.other?`<tr><td colspan="2" style="color:#888;">Aucune condition</td></tr>`:""}
    </table>
  </div>
  <div class="section">
    <div class="section-title">Dates & occupation</div>
    <table>
      <tr><td>Date du notaire souhaitée</td><td>${fmtDate(o.notaryDate)}</td></tr>
      <tr><td>Date d'occupation souhaitée</td><td>${fmtDate(o.occupancyDate)}</td></tr>
      <tr><td>Loyer si délai notaire/occupation</td><td>${o.rent==="oui"?"Oui"+(o.rentDetails?" — "+o.rentDetails:""):"Non"}</td></tr>
    </table>
  </div>
  ${o.inclusions||o.exclusions?`<div class="section">
    <div class="section-title">Inclusions & exclusions</div>
    <table>
      ${o.inclusions?`<tr><td>Inclusions</td><td>${o.inclusions}</td></tr>`:""}
      ${o.exclusions?`<tr><td>Exclusions</td><td>${o.exclusions}</td></tr>`:""}
    </table>
  </div>`:""}
  <div class="footer">BACHA Groupe Immobilier · Document généré par Track · ${new Date().toLocaleDateString("fr-CA")}</div>
  </body></html>`;
  const win = window.open("","_blank");
  win.document.write(html);
  win.document.close();
  setTimeout(()=>win.print(),500);
};

window.opsDeleteListing = async function(lid) {
  if (!confirm("Supprimer cette inscription ?")) return;
  await deleteDoc(doc(db,"ops_listings",lid));
  opsActiveLid = opsListings.filter(x=>x.id!==lid)[0]?.id||null;
  opsView="listings"; renderOps();
};

window.opsSetPurchaseStatus = async function(pid, status) {
  await updateDoc(doc(db,"ops_purchases",pid),{status,updatedAt:serverTimestamp()});
  showToast(OPS_PURCHASE_STATUS_LABELS[status]+" ✓");
};

window.opsUpdatePurchasePrice = async function(pid, val) {
  await updateDoc(doc(db,"ops_purchases",pid),{price:val,updatedAt:serverTimestamp()});
};

window.opsDeletePurchase = async function(pid) {
  if (!confirm("Supprimer cet achat ?")) return;
  await deleteDoc(doc(db,"ops_purchases",pid));
  opsActivePid = opsPurchases.filter(x=>x.id!==pid)[0]?.id||null;
  opsView="purchases"; renderOps();
};

window.opsOpenCondModal = function(type, eid) {
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Ajouter une condition</div><button class="close-x" onclick="closeAllModals()">×</button></div>
    <div class="mbody-ops">
      <div class="form-group"><label>Type</label>
        <select id="ocm-type" onchange="document.getElementById('ocm-cw').style.display=this.value==='Autre'?'block':'none'">
          <option>Financement</option><option>Inspection</option><option>Revue de documents</option><option value="Autre">Autre</option>
        </select></div>
      <div id="ocm-cw" style="display:none;"><div class="form-group"><label>Nom personnalisé</label><input type="text" id="ocm-custom" placeholder="ex: Vente de propriété"></div></div>
      <div class="form-group"><label>Date limite</label><input type="date" id="ocm-date"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsSubmitCond('${type}','${eid}')">Ajouter</button>
    </div>`;
  openModal("opsModal");
};

window.opsSubmitCond = async function(type, eid) {
  const t = document.getElementById("ocm-type").value;
  const name = t==="Autre" ? (document.getElementById("ocm-custom").value.trim()||"Autre") : t;
  const date = document.getElementById("ocm-date").value;
  await opsAddCond(type, eid, name, date);
  closeAllModals();
};


// ── Ops render ─────────────────────────────────────────────
function renderOps() {
  const el = document.getElementById("opsContent");
  const ha = document.getElementById("opsHeaderActions");
  if (!el) return;

  // Build tab bar
  const tabs = `
    <div class="ops-tabs">
      <button class="ops-tab${opsView==="dash"?" active":""}" onclick="opsSetView('dash')">Vue d'ensemble</button>
      <button class="ops-tab${opsView==="listings"?" active":""}" onclick="opsSetView('listings')">Inscriptions <span class="ops-tab-count">${opsListings.filter(l=>!["ferme","vendu"].includes(l.status)).length}</span></button>
      <button class="ops-tab${opsView==="purchases"?" active":""}" onclick="opsSetView('purchases')">Achats <span class="ops-tab-count">${opsPurchases.filter(p=>!OPS_PURCHASE_SOLD.includes(p.status||"active")).length}</span></button>
      <button class="ops-tab${opsView==="ventes"?" active":""}" onclick="opsSetView('ventes')">Ventes <span class="ops-tab-count">${opsListings.filter(l=>["ferme","vendu"].includes(l.status)).length + opsPurchases.filter(p=>OPS_PURCHASE_SOLD.includes(p.status||"active")).length}</span></button>
    </div>`;

  ha.innerHTML = `
    <button class="btn-secondary" onclick="opsOpenNewPurchase()">+ Nouvel achat</button>
    <button class="btn-primary" onclick="opsOpenNewListing()">+ Nouvelle inscription</button>`;

  if (opsView==="dash") { el.innerHTML = tabs + opsRenderDash(); return; }
  if (opsView==="listings") { el.innerHTML = tabs + opsRenderListings(); return; }
  if (opsView==="purchases") { el.innerHTML = tabs + opsRenderPurchases(); return; }
  if (opsView==="ventes") { el.innerHTML = tabs + opsRenderVentes(); return; }
}

window.opsSetView = function(v) { opsView=v; renderOps(); };

function opsRenderDash() {
  const activeL = opsListings.filter(l=>l.status==="offre"&&(l.offers||[]).some(o=>o.status==="accepted"));
  const activeP = opsPurchases.filter(p=>!OPS_PURCHASE_SOLD.includes(p.status||"active"));
  let vol = 0;
  activeL.forEach(l=>vol+=opsParsePx(l.offerPrice||l.price));
  activeP.forEach(p=>vol+=opsParsePx(p.price));
  const comm = vol*0.02;
  let urgCount = 0;
  const allC = [];
  opsListings.forEach(l=>(l.conditions||[]).filter(c=>!c.done).forEach(c=>{const i=opsCondInfo(c);if(i.urg)urgCount++;allC.push({src:l.addr,type:"l",c,i});}));
  opsPurchases.forEach(p=>(p.conditions||[]).filter(c=>!c.done).forEach(c=>{const i=opsCondInfo(c);if(i.urg)urgCount++;allC.push({src:p.addr,type:"p",c,i});}));
  allC.sort((a,b)=>{if(!a.c.date&&!b.c.date)return 0;if(!a.c.date)return 1;if(!b.c.date)return -1;return new Date(a.c.date)-new Date(b.c.date);});

  const ventesL = opsListings.filter(l=>["ferme","vendu"].includes(l.status));
  const ventesP = opsPurchases.filter(p=>OPS_PURCHASE_SOLD.includes(p.status||"active"));
  const volVendu = ventesL.reduce((s,l)=>s+opsParsePx(l.offerPrice||l.price),0) + ventesP.reduce((s,p)=>s+opsParsePx(p.price),0);
  const commVendu = volVendu*0.02;
  const nbVendu = ventesL.length + ventesP.length;

  return `
  <div class="ops-kpi-grid" style="grid-template-columns:repeat(5,minmax(0,1fr));">
    <div class="ops-kpi" style="border-left-color:#0C2B5E"><div class="ops-kpi-l">Dossiers actifs</div><div class="ops-kpi-v">${activeL.length+activeP.length}</div><div class="ops-kpi-s">inscriptions + achats</div></div>
    <div class="ops-kpi" style="border-left-color:#378ADD"><div class="ops-kpi-l">Volume immobilier</div><div class="ops-kpi-v">${opsFmtPx(vol)}</div><div class="ops-kpi-s">valeur totale des dossiers</div></div>
    <div class="ops-kpi" style="border-left-color:#1D9E75"><div class="ops-kpi-l">Commission estimée</div><div class="ops-kpi-v">${opsFmtPx(comm)}</div><div class="ops-kpi-s">2% du volume</div></div>
    <div class="ops-kpi" style="border-left-color:${urgCount>0?"#E24B4A":"#888780"}"><div class="ops-kpi-l">Conditions urgentes</div><div class="ops-kpi-v" style="color:${urgCount>0?"#E24B4A":"var(--text)"}">${urgCount}</div><div class="ops-kpi-s">délai ≤ 3 jours</div></div>
    <div class="ops-kpi" style="border-left-color:#534AB7;background:#F4F3FF;"><div class="ops-kpi-l" style="color:#534AB7;">Volume d'affaire vendu</div><div class="ops-kpi-v" style="color:#534AB7;">${opsFmtPx(volVendu)}</div><div class="ops-kpi-s" style="color:#534AB7;">${nbVendu} dossier${nbVendu!==1?"s":""} · comm. ${opsFmtPx(commVendu)}</div></div>
  </div>
  <div class="ops-two-col">
    <div class="ops-card">
      <div class="ops-card-hd"><span class="ops-card-title">Inscriptions sous contrat</span><span class="ops-pill ops-pill-green">${activeL.length}</span></div>
      ${activeL.length ? activeL.map(l=>{const px=opsParsePx(l.price);const displayPx=opsParsePx(l.offerPrice||l.price);const hasOffer=l.offerPrice&&l.offerPrice!==l.price;return`<div class="ops-deal-row"><div class="ops-deal-dot" style="background:${l.status==="ferme"?"#1D9E75":"#378ADD"}"></div><div class="ops-deal-info"><div class="ops-deal-addr">${l.addr}</div><div class="ops-deal-meta">${[l.seller,l.agent,OPS_STATUS_LABELS[l.status]].filter(Boolean).join(" · ")}</div></div><div><div class="ops-deal-price">${opsFmtPx(displayPx)}${hasOffer?'<span style="font-size:10px;color:#1D9E75;margin-left:4px;">offre</span>':""}</div><div class="ops-deal-comm">${displayPx?"comm. "+opsFmtPx(displayPx*.02):""}</div></div></div>`;}).join("") : `<div class="ops-empty">Aucune inscription sous contrat</div>`}
    </div>
    <div class="ops-card">
      <div class="ops-card-hd"><span class="ops-card-title">Achats sous conditions</span><span class="ops-pill ops-pill-amber">${activeP.length}</span></div>
      ${activeP.length ? activeP.map(p=>{const px=opsParsePx(p.price);const pend=(p.conditions||[]).filter(c=>!c.done).length;return`<div class="ops-deal-row"><div class="ops-deal-dot" style="background:#BA7517"></div><div class="ops-deal-info"><div class="ops-deal-addr">${p.addr}</div><div class="ops-deal-meta">${[p.buyer,p.agent,pend+" cond. en attente"].filter(Boolean).join(" · ")}</div></div><div><div class="ops-deal-price">${opsFmtPx(px)}</div><div class="ops-deal-comm">${px?"comm. "+opsFmtPx(px*.02):""}</div></div></div>`;}).join("") : `<div class="ops-empty">Aucun achat en cours</div>`}
    </div>
  </div>
  <div class="ops-section-label">Toutes les conditions</div>
  <div class="ops-card">${allC.length ? allC.map(({src,type,c,i})=>`<div class="ops-cond-row-dash"><span class="ops-pill ${type==="l"?"ops-pill-green":"ops-pill-amber"}">${type==="l"?"Inscription":"Achat"}</span><span class="ops-cond-src">${src.length>28?src.substring(0,26)+"…":src}</span><span class="ops-cond-nm">${c.name}</span><span class="ops-cond-dt">${opsFmtDate(c.date)}</span><span class="ops-cond-badge ${i.cls}">${i.txt}</span></div>`).join("") : `<div style="padding:2rem;text-align:center;font-size:13px;color:var(--text-3);">Aucune condition enregistrée</div>`}</div>`;
}

function opsFollowUpQueue() {
  const pending = [];
  opsListings.forEach(l=>{
    (opsActivityCache[l.id]||[]).filter(a=>a.followUpRequired&&!a.followUpDone).forEach(a=>{
      pending.push({listing:l.addr, name:a.visitorName||a.agentName||"Visiteur", date:a.date, lid:l.id, aid:a.id, phone:a.phone||""});
    });
  });
  if (!pending.length) return "";
  const rows = pending.sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(p=>`
    <div style="display:flex;align-items:center;gap:10px;padding:.65rem 1rem;border-bottom:1px solid var(--border);">
      <div style="width:8px;height:8px;border-radius:50%;background:#BA7517;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:500;color:var(--text);">${p.name}</div>
        <div style="font-size:11px;color:var(--text-3);">${p.listing}${p.date?" · "+p.date:""}${p.phone?" · "+p.phone:""}</div>
      </div>
      <button class="ops-offer-btn ops-offer-btn-green" onclick="opsMarkFollowUpDone('${p.lid}','${p.aid}')">✓ Fait</button>
    </div>`).join("");
  return `<div class="ops-card" style="margin-bottom:1.5rem;">
    <div class="ops-card-hd"><span class="ops-card-title" style="color:#BA7517;">Suivis requis (${pending.length})</span></div>
    ${rows}
  </div>`;
}

function opsRenderListings() {
  const activeListings = opsListings.filter(l=>!["ferme","vendu"].includes(l.status));
  if (!activeListings.length) return `<div class="empty-state"><div class="empty-icon">◩</div><div class="empty-title">Aucune inscription active</div><div class="empty-sub">Les ventes conclues se trouvent dans l'onglet Ventes.</div></div>`;
  if (!opsActiveLid || !activeListings.find(x=>x.id===opsActiveLid)) opsActiveLid = activeListings[0].id;
  const l = activeListings.find(x=>x.id===opsActiveLid);
  const p = opsLProg(l);
  const bc = p.pct===100?"#1D9E75":p.pct>50?"#378ADD":"#BA7517";

  const tabs = opsListings.map(li=>{
    const pr=opsLProg(li); const short=li.addr.length>22?li.addr.substring(0,20)+"…":li.addr;
    const urg=opsHasUrg(li.conditions);
    return `<div class="ops-rec-tab${opsActiveLid===li.id?" active":""}" onclick="opsSetLTab('${li.id}')">${short} <span class="ops-tab-pct">${pr.pct}%</span>${urg?'<span class="ops-urgdot"></span>':""}</div>`;
  }).join("");

  // Subscribe to activity for this listing
  opsSubscribeActivity(l.id);

  // Inner view tabs
  const innerTabs = `<div class="ops-inner-tabs">
    <button class="ops-inner-tab${opsListingView==="checklist"?" active":""}" onclick="opsSetListingView('checklist')">SOP Checklist</button>
    <button class="ops-inner-tab${opsListingView==="conditions"?" active":""}" onclick="opsSetListingView('conditions')">Conditions</button>
    <button class="ops-inner-tab${opsListingView==="offers"?" active":""}" onclick="opsSetListingView('offers')">Offres <span class="ops-tab-count">${(l.offers||[]).length}</span></button>
    <button class="ops-inner-tab${opsListingView==="activity"?" active":""}" onclick="opsSetListingView('activity')">Activité <span class="ops-tab-count">${opsGetActivity(l.id).length}</span></button>
  </div>`;

  // Route to correct inner view
  if (opsListingView === "conditions") {
    return `<div class="ops-rec-tabs">${tabs}</div>${listingHdr}${innerTabs}${opsCondsBlock("l", l)}`;
  }
  if (opsListingView === "offers") {
    return `<div class="ops-rec-tabs">${tabs}</div>${listingHdr}${innerTabs}${opsOffersBlock(l)}`;
  }
  if (opsListingView === "activity") {
    return `<div class="ops-rec-tabs">${tabs}</div>${listingHdr}${innerTabs}${opsActivityView(l)}`;
  }

  // Default: checklist
  const condsHtml = opsCondsBlock("l", l);

  let phasesHtml = "";
  OPS_PHASES.forEach(ph=>{
    const dn = ph.tasks.filter(t=>(l.checklist||{})[t.id]).length;
    phasesHtml += `<div class="ops-phase">
      <div class="ops-phdr" onclick="opsTogglePhase('${ph.id}')">
        <div class="ops-pdot" style="background:${ph.color}"></div>
        <div class="ops-ptitle">${ph.label}</div>
        <div class="ops-pmeta">${dn}/${ph.tasks.length}</div>
        <div class="ops-pchev" id="opschev-${ph.id}">▼</div>
      </div>
      <div class="ops-pbody" id="opsbody-${ph.id}" style="display:none;">
        ${ph.tasks.map(t=>{const on=(l.checklist||{})[t.id];return`<div class="ops-task"><div class="ops-tchk${on?" on":""}" onclick="opsToggleTask('${l.id}','${t.id}')"></div><div class="ops-tcon"><div class="ops-tname${on?" on":""}">${t.name}</div><div class="ops-tmeta"><span class="ops-tag ops-tw">${t.who}</span><span class="ops-tag ops-tt">${t.tool}</span><span class="ops-tag ops-ti">${t.time}</span></div><div class="ops-tdet">${t.det}</div></div></div>`;}).join("")}
      </div></div>`;
  });

  const listingHdr = `<div class="ops-listing-hdr">
      <div>
        <div class="ops-addr-big">${l.addr} <span class="ops-status-badge" style="background:${OPS_STATUS_COLORS[l.status]}20;color:${OPS_STATUS_COLORS[l.status]};border:1px solid ${OPS_STATUS_COLORS[l.status]}40">${OPS_STATUS_LABELS[l.status]}</span></div>
        <div class="ops-listing-sub">${[l.seller,l.agent].filter(Boolean).join(" · ")}</div>
        <div style="display:flex;align-items:center;gap:16px;margin-top:6px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:12px;color:var(--text-3);">Prix inscrit :</span>
            <input type="text" value="${l.price||""}" onchange="opsUpdateListingPrice('${l.id}','price',this.value)" style="font-size:13px;font-weight:500;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:140px;" placeholder="ex: 549 000 $" />
          </div>
          ${l.offerPrice?`<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:12px;color:var(--text-3);">Prix offre :</span><input type="text" value="${l.offerPrice||""}" onchange="opsUpdateListingPrice('${l.id}','offerPrice',this.value)" style="font-size:13px;font-weight:600;padding:3px 8px;border-radius:6px;border:1px solid #1D9E75;background:var(--surface);color:#1D9E75;width:140px;" /></div>`:""}
        </div>
      </div>
      <div class="ops-lactions">
        <button class="btn-primary" style="font-size:13px;padding:7px 16px;background:#185FA5;border:none;" onclick="opsOpenNewOffer('${l.id}')">+ Nouvelle offre</button>
        <select class="ops-status-sel" onchange="opsChgStatus('${l.id}',this.value)">
          <option value="active"${l.status==="active"?" selected":""}>Actif</option>
          <option value="offre"${l.status==="offre"?" selected":""}>Offre reçue</option>
          <option value="ferme"${l.status==="ferme"?" selected":""}>Vente ferme</option>
          <option value="vendu"${l.status==="vendu"?" selected":""}>Vendu</option>
        </select>
        ${isAdmin?`<button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="opsDeleteListing('${l.id}')">Supprimer</button>`:""}
      </div>
    </div>\`;

  return `<div class="ops-rec-tabs">${tabs}</div>${listingHdr}${innerTabs}
    <div class="ops-stats-row">
      <div class="ops-stat"><div class="ops-stat-l">Total</div><div class="ops-stat-v">${p.tot}</div></div>
      <div class="ops-stat"><div class="ops-stat-l">Complétés</div><div class="ops-stat-v">${p.dn}</div></div>
      <div class="ops-stat"><div class="ops-stat-l">Restants</div><div class="ops-stat-v">${p.tot-p.dn}</div></div>
      <div class="ops-stat"><div class="ops-stat-l">Progrès</div><div class="ops-stat-v">${p.pct}%</div></div>
    </div>
    <div class="ops-pbar-wrap"><div class="ops-pbar-fill" style="width:${p.pct}%;background:${bc}"></div></div>
    ${phasesHtml}`;
}

function opsRenderPurchases() {
  const activePurchases = opsPurchases.filter(p=>!OPS_PURCHASE_SOLD.includes(p.status||"active"));
  if (!activePurchases.length) return `<div class="empty-state"><div class="empty-icon">◩</div><div class="empty-title">Aucun achat actif</div><div class="empty-sub">Les achats conclus se trouvent dans l'onglet Ventes.</div></div>`;
  if (!opsActivePid || !activePurchases.find(x=>x.id===opsActivePid)) opsActivePid = activePurchases[0].id;
  const p = activePurchases.find(x=>x.id===opsActivePid);
  const pr = opsPProg(p);
  const r=32; const circ=2*Math.PI*r; const off=circ-(pr.pct/100)*circ;
  const rc = pr.pct===100?"#1D9E75":pr.pct>50?"#378ADD":"#BA7517";
  const pStatus = p.status||"active";
  const pStatusColor = OPS_PURCHASE_STATUS_COLORS[pStatus]||"#888780";
  const pStatusLabel = OPS_PURCHASE_STATUS_LABELS[pStatus]||"Actif";

  const tabs = activePurchases.map(pu=>{
    const short=pu.addr.length>22?pu.addr.substring(0,20)+"…":pu.addr;
    const urg=opsHasUrg(pu.conditions);
    return `<div class="ops-rec-tab${opsActivePid===pu.id?" active":""}" onclick="opsSetPTab('${pu.id}')">${short}${urg?'<span class="ops-urgdot"></span>':""}</div>`;
  }).join("");

  // Status progression buttons
  const statusFlow = [
    {key:"offre", label:"✓ Offre acceptée", color:"#185FA5"},
    {key:"cond", label:"✓ Conditions réalisées", color:"#1D9E75"},
    {key:"notarie", label:"✓ Notarié", color:"#534AB7"},
  ];
  const currentIdx = ["active","offre","cond","notarie"].indexOf(pStatus);
  const nextStep = statusFlow.find((s,i)=>i>=currentIdx);
  const statusBtn = nextStep ? `<button class="btn-primary" style="font-size:13px;padding:7px 16px;background:${nextStep.color};border:none;" onclick="opsSetPurchaseStatus('${p.id}','${nextStep.key}')">${nextStep.label}</button>` : "";

  return `
    <div class="ops-rec-tabs">${tabs}</div>
    <div class="ops-listing-hdr">
      <div style="display:flex;align-items:center;gap:16px;">
        <div class="ops-ring-wrap">
          <svg width="70" height="70" viewBox="0 0 70 70"><circle cx="35" cy="35" r="${r}" fill="none" stroke="#eee" stroke-width="5"/><circle cx="35" cy="35" r="${r}" fill="none" stroke="${rc}" stroke-width="5" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 35 35)"/></svg>
          <div class="ops-ring-pct">${pr.pct}%</div>
        </div>
        <div>
          <div class="ops-addr-big">${p.addr} <span class="ops-status-badge" style="background:${pStatusColor}20;color:${pStatusColor};border:1px solid ${pStatusColor}40">${pStatusLabel}</span></div>
          <div class="ops-listing-sub">${[p.buyer,p.agent].filter(Boolean).join(" · ")}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;color:var(--text-3);">Prix :</span>
              <input type="text" value="${p.price||""}" onchange="opsUpdatePurchasePrice('${p.id}',this.value)" style="font-size:13px;font-weight:600;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:140px;" placeholder="ex: 489 000 $" />
            </div>
            <div style="font-size:12px;color:var(--text-3);">${pr.dn} condition${pr.dn!==1?"s":""} levée${pr.dn!==1?"s":""} sur ${pr.tot}</div>
          </div>
        </div>
      </div>
      <div class="ops-lactions">
        ${statusBtn}
        <button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="opsGeneratePurchasePDF('${p.id}')">PDF ↗</button>
        ${pStatus!=="active"?`<button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="opsSetPurchaseStatus('${p.id}','active')">↩ Réinitialiser</button>`:""}
        <button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="opsOpenNewPurchase('${p.id}')">Modifier</button>
        ${isAdmin?`<button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="opsDeletePurchase('${p.id}')">Supprimer</button>`:""}
      </div>
    </div>
    ${opsCondsBlock("p", p)}`;
}

function opsOffersBlock(l) {
  const offers = l.offers||[];
  if (!offers.length) return "";
  const statusConfig = {
    pending:  {label:"En attente",  color:"#185FA5", bg:"#E6F1FB"},
    accepted: {label:"Acceptée",    color:"#1D9E75", bg:"#E1F5EE"},
    second:   {label:"2e rang",     color:"#BA7517", bg:"#FAEEDA"},
    refused:  {label:"Refusée",     color:"#888780", bg:"#F1EFE8"},
  };
  const fmtDate = ds => { if(!ds) return "—"; const [y,m,d]=ds.slice(0,10).split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"short"}); };

  const rows = offers.map(o=>{
    const sc = statusConfig[o.status]||statusConfig.pending;
    const isAccepted = o.status==="accepted";
    const deadlineRows = isAccepted&&o.deadlines ? [
      o.deadlines.inspection?`<div class="ops-deadline-row"><span>Inspection</span><span>${fmtDate(o.deadlines.inspection)}</span></div>`:"",
      o.deadlines.financing?`<div class="ops-deadline-row"><span>Financement</span><span>${fmtDate(o.deadlines.financing)}</span></div>`:"",
      o.deadlines.docReview?`<div class="ops-deadline-row"><span>Revue de documents</span><span>${fmtDate(o.deadlines.docReview)}</span></div>`:"",
      o.deadlines.other?`<div class="ops-deadline-row"><span>Autre condition</span><span>${fmtDate(o.deadlines.other)}</span></div>`:"",
    ].filter(Boolean).join("") : "";

    return `<div class="ops-offer-card${isAccepted?" ops-offer-accepted":""}">
      <div class="ops-offer-top">
        <div class="ops-offer-who">
          <div class="ops-offer-name">${o.buyer||o.agent||"Offre sans nom"}</div>
          ${o.buyer&&o.agent?`<div class="ops-offer-sub">${o.agent}</div>`:""}
        </div>
        <div style="text-align:right;">
          <div class="ops-offer-price">${o.price||"—"}</div>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${sc.bg};color:${sc.color};font-weight:500;">${sc.label}</span>
        </div>
      </div>
      ${o.conditions?.inspection||o.conditions?.financing||o.conditions?.docReview||o.conditions?.other?`
      <div class="ops-offer-conds">
        ${o.conditions.inspection?`<span class="ops-offer-cond-tag">Inspection ${o.conditions.inspection}j</span>`:""}
        ${o.conditions.financing?`<span class="ops-offer-cond-tag">Financement ${o.conditions.financing}j</span>`:""}
        ${o.conditions.docReview?`<span class="ops-offer-cond-tag">Documents ${o.conditions.docReview}j</span>`:""}
        ${o.conditions.other?`<span class="ops-offer-cond-tag">Autre ${o.conditions.other}j</span>`:""}
      </div>`:""}
      ${isAccepted&&deadlineRows?`<div class="ops-deadlines">${deadlineRows}</div>`:""}
      <div class="ops-offer-actions">
        ${o.status==="pending"?`
          <button class="ops-offer-btn ops-offer-btn-green" onclick="opsAcceptOffer('${l.id}','${o.id}')">✓ Accepter</button>
          <button class="ops-offer-btn ops-offer-btn-amber" onclick="opsSetOfferStatus('${l.id}','${o.id}','second')">2e rang</button>
          <button class="ops-offer-btn ops-offer-btn-gray" onclick="opsSetOfferStatus('${l.id}','${o.id}','refused')">Refuser</button>
        `:""}
        ${o.status==="second"?`
          <button class="ops-offer-btn ops-offer-btn-green" onclick="opsAcceptOffer('${l.id}','${o.id}')">✓ Accepter</button>
          <button class="ops-offer-btn ops-offer-btn-gray" onclick="opsSetOfferStatus('${l.id}','${o.id}','refused')">Refuser</button>
        `:""}
        ${o.status==="refused"?`
          <button class="ops-offer-btn ops-offer-btn-gray" onclick="opsSetOfferStatus('${l.id}','${o.id}','pending')">↩ Remettre en attente</button>
        `:""}
        <button class="ops-offer-btn" onclick="opsEditOffer('${l.id}','${o.id}')">Modifier</button>
        <button class="ops-offer-btn" onclick="opsGenerateOfferPDF('${l.id}','${o.id}')">PDF ↗</button>
        <button class="ops-offer-btn ops-offer-btn-red" onclick="opsDeleteOffer('${l.id}','${o.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join("");

  return `<div class="ops-conds-card" style="margin-bottom:1.25rem;">
    <div class="ops-conds-hd"><span>Offres reçues (${offers.length})</span></div>
    <div style="padding:.5rem;">${rows}</div>
  </div>`;
}

window.opsGeneratePurchasePDF = function(pid) {
  const p = opsPurchases.find(x=>x.id===pid);
  if (!p) return;
  const fmtDate = ds => { if(!ds) return "—"; const [y,m,d]=ds.slice(0,10).split("-").map(Number); const dt=new Date(y,m-1,d); return dt.toLocaleDateString("fr-CA",{day:"numeric",month:"long",year:"numeric"}); };
  const fmtDeadline = (ds, days) => { if(!ds&&!days) return "—"; if(ds) return fmtDate(ds)+(days?` (${days}j)`:""); return `${days} jours à compter de la signature`; };
  const oc = p.offerConditions||{};
  const dl = p.deadlines||{};
  const statusLabels={active:"Active",offre:"Offre acceptée",cond:"Conditions réalisées",notarie:"Notarié"};
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Promesse d'achat — ${p.addr}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;margin:40px;line-height:1.6;}
    h1{font-size:20px;color:#0C2B5E;margin-bottom:4px;}
    .sub{font-size:13px;color:#666;margin-bottom:24px;}
    .section{margin-bottom:20px;}
    .section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0C2B5E;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:10px;}
    .price{font-size:22px;font-weight:700;color:#0C2B5E;}
    table{width:100%;border-collapse:collapse;}
    td{padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;}
    td:first-child{color:#888;width:220px;}
    td:last-child{font-weight:500;}
    .footer{margin-top:40px;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:12px;}
  </style></head><body>
  <h1>BACHA Groupe Immobilier</h1>
  <div class="sub">Résumé de promesse d'achat — généré le ${fmtDate(new Date().toISOString().slice(0,10))}</div>

  <div class="section">
    <div class="section-title">Propriété</div>
    <table>
      <tr><td>Adresse</td><td style="font-size:16px;font-weight:700;">${p.addr}</td></tr>
      ${p.sellerAgent?`<tr><td>Courtier vendeur</td><td>${p.sellerAgent}</td></tr>`:""}
    </table>
  </div>

  <div class="section">
    <div class="section-title">Offre</div>
    <table>
      <tr><td>Acheteur</td><td>${p.buyer||"—"}</td></tr>
      <tr><td>Courtier BACHA</td><td>${p.agent||"—"}</td></tr>
      <tr><td>Prix offert</td><td class="price">${p.price||"—"}</td></tr>
      <tr><td>Validité de l'offre</td><td>${p.validity||"—"}</td></tr>
      <tr><td>Statut</td><td>${statusLabels[p.status]||"—"}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Conditions</div>
    <table>
      ${oc.inspection?`<tr><td>Inspection</td><td>${fmtDeadline(dl.inspection,oc.inspection)}</td></tr>`:""}
      ${oc.financing?`<tr><td>Financement</td><td>${fmtDeadline(dl.financing,oc.financing)}</td></tr>`:""}
      ${oc.docReview?`<tr><td>Revue de documents</td><td>${fmtDeadline(dl.docReview,oc.docReview)}${oc.docList?`<br><span style="font-size:12px;color:#666;">Documents : ${oc.docList}</span>`:""}</td></tr>`:""}
      ${oc.other?`<tr><td>Autre condition</td><td>${fmtDeadline(dl.other,oc.other)}${oc.otherDetails?`<br><span style="font-size:12px;color:#666;">${oc.otherDetails}</span>`:""}</td></tr>`:""}
      ${!oc.inspection&&!oc.financing&&!oc.docReview&&!oc.other?`<tr><td colspan="2" style="color:#888;">Aucune condition</td></tr>`:""}
    </table>
  </div>

  <div class="section">
    <div class="section-title">Dates & occupation</div>
    <table>
      <tr><td>Date du notaire souhaitée</td><td>${fmtDate(p.notaryDate)}</td></tr>
      <tr><td>Date d'occupation souhaitée</td><td>${fmtDate(p.occupancyDate)}</td></tr>
      <tr><td>Loyer si délai notaire/occupation</td><td>${p.rent==="oui"?"Oui"+(p.rentDetails?" — "+p.rentDetails:""):"Non"}</td></tr>
    </table>
  </div>

  ${p.inclusions||p.exclusions?`<div class="section">
    <div class="section-title">Inclusions & exclusions</div>
    <table>
      ${p.inclusions?`<tr><td>Inclusions</td><td>${p.inclusions}</td></tr>`:""}
      ${p.exclusions?`<tr><td>Exclusions</td><td>${p.exclusions}</td></tr>`:""}
    </table>
  </div>`:""}

  <div class="footer">BACHA Groupe Immobilier · Document généré par Track · ${new Date().toLocaleDateString("fr-CA")}</div>
  </body></html>`;
  const win = window.open("","_blank");
  win.document.write(html);
  win.document.close();
  setTimeout(()=>win.print(),500);
};

function opsRenderVentes() {
  const ventesL = opsListings.filter(l=>["ferme","vendu"].includes(l.status));
  const ventesP = opsPurchases.filter(p=>OPS_PURCHASE_SOLD.includes(p.status||"active"));
  const totalVol = ventesL.reduce((s,l)=>s+opsParsePx(l.offerPrice||l.price),0) + ventesP.reduce((s,p)=>s+opsParsePx(p.price),0);
  const totalComm = totalVol*0.02;
  const nbTotal = ventesL.length + ventesP.length;

  if (!nbTotal) return `<div class="empty-state"><div class="empty-icon">◩</div><div class="empty-title">Aucune vente conclue</div><div class="empty-sub">Les inscriptions en vente ferme/vendu et les achats en conditions réalisées/notariés apparaîtront ici.</div></div>`;

  const listingRows = ventesL.map(l=>{
    const px = opsParsePx(l.offerPrice||l.price);
    const statusColor = l.status==="vendu"?"#534AB7":"#1D9E75";
    return `<div class="ops-vente-row">
      <div class="ops-vente-main">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:#E1F5EE;color:#085041;font-weight:500;">Inscription</span>
          <div class="ops-vente-addr">${l.addr}</div>
        </div>
        <div class="ops-vente-meta">${[l.seller,l.agent].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="ops-vente-fields">
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Prix accepté</div>
          <div class="ops-vente-field-val">${opsFmtPx(px)}</div>
          ${l.offerPrice&&l.offerPrice!==l.price?`<div style="font-size:11px;color:var(--text-3);">Inscrit: ${l.price}</div>`:""}
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Commission est.</div>
          <div class="ops-vente-field-val" style="color:#1D9E75;">${px?opsFmtPx(px*0.02):"—"}</div>
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Date du notaire</div>
          <input type="date" value="${l.notaryDate||""}" onchange="opsUpdateNotaryDate('${l.id}',this.value)" style="font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:145px;" />
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Statut</div>
          <span style="font-size:12px;font-weight:500;padding:3px 10px;border-radius:99px;background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;">${OPS_STATUS_LABELS[l.status]}</span>
        </div>
      </div>
      <div class="ops-vente-actions">
        <button class="ops-offer-btn" onclick="opsVenteEditListing('${l.id}')">Modifier</button>
        <button class="ops-offer-btn ops-offer-btn-amber" onclick="opsVenteSendBack('listing','${l.id}')">↩ Renvoyer aux inscriptions</button>
        <button class="ops-offer-btn ops-offer-btn-red" onclick="opsDeleteListing('${l.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join("");

  const purchaseRows = ventesP.map(p=>{
    const px = opsParsePx(p.price);
    const statusColor = OPS_PURCHASE_STATUS_COLORS[p.status]||"#534AB7";
    return `<div class="ops-vente-row">
      <div class="ops-vente-main">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:#FAEEDA;color:#633806;font-weight:500;">Achat</span>
          <div class="ops-vente-addr">${p.addr}</div>
        </div>
        <div class="ops-vente-meta">${[p.buyer,p.agent].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="ops-vente-fields">
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Prix d'achat</div>
          <div class="ops-vente-field-val">${opsFmtPx(px)}</div>
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Commission est.</div>
          <div class="ops-vente-field-val" style="color:#1D9E75;">${px?opsFmtPx(px*0.02):"—"}</div>
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Date du notaire</div>
          <input type="date" value="${p.notaryDate||""}" onchange="opsUpdatePurchaseNotaryDate('${p.id}',this.value)" style="font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:145px;" />
        </div>
        <div class="ops-vente-field">
          <div class="ops-vente-field-label">Statut</div>
          <span style="font-size:12px;font-weight:500;padding:3px 10px;border-radius:99px;background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;">${OPS_PURCHASE_STATUS_LABELS[p.status]}</span>
        </div>
      </div>
      <div class="ops-vente-actions">
        <button class="ops-offer-btn" onclick="opsOpenNewPurchase('${p.id}')">Modifier</button>
        <button class="ops-offer-btn ops-offer-btn-amber" onclick="opsVenteSendBack('purchase','${p.id}')">↩ Renvoyer aux achats</button>
        <button class="ops-offer-btn ops-offer-btn-red" onclick="opsDeletePurchase('${p.id}')">Supprimer</button>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="ops-ventes-summary">
      <div class="ops-vente-kpi"><div class="ops-kpi-l">Dossiers conclus</div><div class="ops-kpi-v">${nbTotal}</div><div class="ops-kpi-s">${ventesL.length} inscription${ventesL.length!==1?"s":""} · ${ventesP.length} achat${ventesP.length!==1?"s":""}</div></div>
      <div class="ops-vente-kpi"><div class="ops-kpi-l">Volume total</div><div class="ops-kpi-v">${opsFmtPx(totalVol)}</div></div>
      <div class="ops-vente-kpi"><div class="ops-kpi-l">Commission totale est.</div><div class="ops-kpi-v" style="color:#1D9E75;">${opsFmtPx(totalComm)}</div></div>
    </div>
    ${ventesL.length?`<div style="font-size:11px;font-weight:500;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">Inscriptions</div><div class="ops-card" style="margin-bottom:1rem;">${listingRows}</div>`:""}
    ${ventesP.length?`<div style="font-size:11px;font-weight:500;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">Achats</div><div class="ops-card">${purchaseRows}</div>`:""}`;
}

window.opsVenteSendBack = async function(type, id) {
  if (type==="listing") {
    await updateDoc(doc(db,"ops_listings",id),{status:"offre",updatedAt:serverTimestamp()});
    opsActiveLid=id; opsView="listings";
    showToast("Dossier renvoyé aux inscriptions ✓");
  } else {
    await updateDoc(doc(db,"ops_purchases",id),{status:"offre",updatedAt:serverTimestamp()});
    opsActivePid=id; opsView="purchases";
    showToast("Dossier renvoyé aux achats ✓");
  }
};

window.opsVenteEditListing = function(lid) {
  openModal("lm");
  const l = opsListings.find(x=>x.id===lid);
  if (!l) return;
  document.getElementById("lm-title").textContent="Modifier l'inscription";
  document.getElementById("lm-addr").value=l.addr||"";
  document.getElementById("lm-seller").value=l.seller||"";
  document.getElementById("lm-price").value=l.price||"";
  document.getElementById("lm-agent").value=l.agent||"Karim";
  document.getElementById("lm-status").value=l.status||"active";
  // Store edit id for save
  window._opsEditListingId = lid;
};

window.opsUpdateNotaryDate = async function(lid, val) {
  await updateDoc(doc(db,"ops_listings",lid),{notaryDate:val,updatedAt:serverTimestamp()});
};

window.opsUpdatePurchaseNotaryDate = async function(pid, val) {
  await updateDoc(doc(db,"ops_purchases",pid),{notaryDate:val,updatedAt:serverTimestamp()});
};

function opsCondsBlock(type, rec) {
  const conds = rec.conditions||[];
  const urg = conds.filter(c=>!c.done&&c.date&&opsDaysUntil(c.date)<=3&&opsDaysUntil(c.date)>=0);
  const exp = conds.filter(c=>!c.done&&c.date&&opsDaysUntil(c.date)<0);
  let alerts="";
  if (urg.length) alerts+=`<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:#FCEBEB;border:1px solid #F09595;margin-bottom:8px;"><div style="width:8px;height:8px;border-radius:50%;background:#E24B4A;flex-shrink:0;"></div><div style="font-size:13px;font-weight:500;color:#791F1F;">Urgent : ${urg.map(c=>`${c.name} (${opsDaysUntil(c.date)===0?"aujourd'hui":opsDaysUntil(c.date)+"j"})`).join(", ")}</div></div>`;
  if (exp.length) alerts+=`<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;background:#FAEEDA;border:1px solid #FAC775;margin-bottom:8px;"><div style="width:8px;height:8px;border-radius:50%;background:#BA7517;flex-shrink:0;"></div><div style="font-size:13px;font-weight:500;color:#633806;">Expirée(s) : ${exp.map(c=>c.name).join(", ")}</div></div>`;
  const rows = conds.length ? conds.map(c=>{
    const i=opsCondInfo(c);
    return `<div class="ops-crow">
      <div class="ops-cchk${c.done?" on":""}" onclick="opsToggleCond('${type}','${rec.id}','${c.id}')"></div>
      <div class="ops-cname"${c.done?' style="text-decoration:line-through;color:var(--text-3)"':''}>${c.name}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        <label style="font-size:12px;color:var(--text-2);">Date limite</label>
        <input type="date" value="${c.date||""}" onchange="opsUpdateCondDate('${type}','${rec.id}','${c.id}',this.value)" style="font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);width:138px;">
      </div>
      <span class="ops-cond-badge ${i.cls}">${i.txt}</span>
      <button onclick="opsDelCond('${type}','${rec.id}','${c.id}')" style="font-size:11px;color:var(--red);padding:2px 6px;border-radius:6px;border:1px solid #F09595;background:none;cursor:pointer;">×</button>
    </div>`;
  }).join("") : `<div style="padding:1rem;text-align:center;font-size:13px;color:var(--text-3);">Aucune condition — cliquez sur "+ Condition"</div>`;
  return `<div class="ops-conds-card">
    <div class="ops-conds-hd"><span>Conditions de l'offre</span><button class="btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="opsOpenCondModal('${type}','${rec.id}')">+ Condition</button></div>
    <div style="padding:${conds.length||urg.length||exp.length?"0":"0"}">${alerts}${rows}</div>
  </div>`;
}

window.opsSetLTab = function(lid) { opsActiveLid=lid; opsSubscribeActivity(lid); renderOps(); };
window.opsSetListingView = function(v) { opsListingView=v; renderOps(); };
window.opsSetPTab = function(pid) { opsActivePid=pid; renderOps(); };
window.opsTogglePhase = function(pid) {
  const body = document.getElementById("opsbody-"+pid);
  const chev = document.getElementById("opschev-"+pid);
  if (!body) return;
  const open = body.style.display!=="none";
  body.style.display = open?"none":"block";
  if (chev) chev.style.transform = open?"":"rotate(180deg)";
};


// ── Prospects (unchanged from original) ────────────────────
function subscribeToProspects() {
  const q = query(collection(db,"prospects"), orderBy("createdAt","desc"));
  unsubscribeProspects = onSnapshot(q, snap => {
    allProspects = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderProspects(); updateProspectCount();
    if (isAdmin) renderDashboard();
    const perfView = document.getElementById("view-performance");
    if (perfView&&perfView.classList.contains("active")) renderPerformanceView();
  });
}
function subscribeToTargets() {
  const todayKey = getTodayKey();
  const targetDoc = doc(db,"targets",`${currentUser.uid}_${todayKey}`);
  unsubscribeTargets = onSnapshot(targetDoc, snap => {
    if (snap.exists()) { const data=snap.data(); if (data.date===todayKey) todaysTargets=data.prospectIds||[]; else todaysTargets=[]; }
    else todaysTargets=[];
    updateTargetNav(); renderProspects();
    const view=document.getElementById("view-targets");
    if (view&&view.classList.contains("active")) renderTargetsView();
  });
}
function updateTargetNav() {
  const n=todaysTargets.length; const badge=n>0?` (${n})`:"";
  const navEl=document.getElementById("targetsNavLabel"); if (navEl) navEl.textContent=`Today's Targets${badge}`;
  const mEl=document.getElementById("targetsNavLabelMobile"); if (mEl) mEl.textContent=`Today's Targets${badge}`;
}
window.toggleTarget = async function(prospectId) {
  const todayKey=getTodayKey(); const ref=doc(db,"targets",`${currentUser.uid}_${todayKey}`);
  const newT=todaysTargets.includes(prospectId)?todaysTargets.filter(id=>id!==prospectId):[...todaysTargets,prospectId];
  await setDoc(ref,{prospectIds:newT,date:todayKey,agentId:currentUser.uid});
};
window.removeTarget = async function(prospectId) {
  const todayKey=getTodayKey(); const ref=doc(db,"targets",`${currentUser.uid}_${todayKey}`);
  await setDoc(ref,{prospectIds:todaysTargets.filter(id=>id!==prospectId),date:todayKey,agentId:currentUser.uid});
};
window.clearAllTargets = async function() {
  if (!confirm("Clear all targets for today?")) return;
  const todayKey=getTodayKey(); await setDoc(doc(db,"targets",`${currentUser.uid}_${todayKey}`),{prospectIds:[],date:todayKey,agentId:currentUser.uid});
};
function renderTargetsView() {
  const el=document.getElementById("targetsContent"); if (!el) return;
  const targets=allProspects.filter(p=>todaysTargets.includes(p.id));
  if (!targets.length) { el.innerHTML=`<div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-title">No targets for today</div><div class="empty-sub">Go to Prospects and click the 🎯 button on any card.</div></div>`; return; }
  const addresses=targets.map(p=>{const o=p.owners?.[0];if(o&&o.street)return`${o.street}, ${o.city}`;return"";}).filter(Boolean);
  const mapsUrl=addresses.length>1?`https://www.google.com/maps/dir/${addresses.map(a=>encodeURIComponent(a)).join("/")}`:addresses.length===1?`https://www.google.com/maps/search/${encodeURIComponent(addresses[0])}`:"";
  const stopsList=targets.map((p,i)=>{
    const o=p.owners?.[0]; const addr=o?`${o.street}, ${o.city} ${o.postal}`:"—";
    const propType=detectPropertyType(p.listingAddress); const mailings=(p.mail||[]).filter(Boolean).length;
    const evalBooked=(p.visits||[]).some(v=>v.evalBooked==="yes"); const contacted=(p.visits||[]).some(v=>v.contact==="yes");
    const statusColor=evalBooked?"#2D6A4F":contacted?"#1D4ED8":mailings>0?"#92400E":"#6B7280";
    const statusLabel=evalBooked?"Eval booked":contacted?"Contacted":mailings>0?`${mailings} mailings`:"Not contacted";
    const mapsAddr=o&&o.street?`${o.street}, ${o.city}`:"";
    return `<div style="display:flex;gap:14px;align-items:flex-start;padding:14px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);margin-bottom:10px;">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;">${i+1}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:600;margin-bottom:2px;">${(p.owners||[]).map(o=>o.name).join(", ")}</div>
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px;">📍 ${addr}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${propType==='condo'?'#EEEDFE':'#EAF3DE'};color:${propType==='condo'?'#3C3489':'#2D6A4F'};">${propType==='condo'?'🏢':'🏠'} ${propType}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:var(--surface);border:1px solid var(--border);color:${statusColor};">${statusLabel}</span>
          <span style="font-size:11px;color:var(--text-3);">MLS #${p.mls}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
        ${mapsAddr?`<a href="https://www.google.com/maps/search/${encodeURIComponent(mapsAddr)}" target="_blank" style="font-size:11px;padding:4px 8px;border-radius:6px;background:var(--accent-light);color:var(--accent);text-decoration:none;white-space:nowrap;">📍 Maps</a>`:""}
        <button onclick="removeTarget('${p.id}')" style="font-size:11px;padding:4px 8px;border-radius:6px;background:var(--red-bg);color:var(--red);border:none;cursor:pointer;font-family:var(--font);white-space:nowrap;">✕ Remove</button>
      </div>
    </div>`;
  }).join("");
  el.innerHTML=`<div style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><div style="flex:1;font-size:13px;color:var(--text-2);">${targets.length} stop${targets.length!==1?"s":""} · ${new Date().toLocaleDateString("en-CA",{weekday:"long",month:"long",day:"numeric"})}</div>${mapsUrl?`<a href="${mapsUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:var(--radius);background:var(--accent);color:#fff;font-size:13px;font-weight:500;text-decoration:none;font-family:var(--font);">🗺 Open route in Google Maps</a>`:""}<button onclick="clearAllTargets()" style="padding:9px 14px;border-radius:var(--radius);background:var(--red-bg);color:var(--red);border:none;font-size:13px;font-family:var(--font);cursor:pointer;">Clear all</button></div><div style="background:var(--accent-light);border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--accent);line-height:1.6;">🎯 Stops are listed in the order you added them. Google Maps will optimize the route automatically.</div>${stopsList}`;
}
function renderPerformanceView() {
  const el=document.getElementById("performanceContent"); if (!el) return;
  if (isAdmin) renderAdminPerformance(el); else renderAgentPerformance(el,currentUser.uid,currentUserProfile?.name||currentUser.email);
}
function renderTierMeter(doors,structure) {
  const tiers=structure.tiers; const maxDoors=tiers[tiers.length-1].doors; const pct=Math.min((doors/maxDoors)*100,100);
  const tier1=tiers[0]; const tier2=tiers[1]; const tier1Pct=(tier1.doors/maxDoors)*100;
  const currentTier=doors>=tier2.doors?2:doors>=tier1.doors?1:0;
  const tierColors=["#6B7280","#F59E0B","#10B981"]; const tierLabels=["No tier yet",`${tier1.label} unlocked 🎉`,`${tier2.label} unlocked 🏆`];
  const nextTier=currentTier<2?tiers[currentTier]:null; const doorsLeft=nextTier?nextTier.doors-doors:0;
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div><div style="font-size:22px;font-weight:700;color:var(--text);">${doors} doors</div><div style="font-size:13px;color:${tierColors[currentTier]};font-weight:500;margin-top:2px;">${tierLabels[currentTier]}</div></div>
      ${nextTier?`<div style="text-align:right;"><div style="font-size:12px;color:var(--text-3);">Next tier in</div><div style="font-size:20px;font-weight:700;color:var(--accent);">${doorsLeft} doors</div></div>`:`<div style="font-size:28px;">🏆</div>`}
    </div>
    <div style="position:relative;height:20px;background:var(--bg);border-radius:99px;overflow:visible;margin-bottom:24px;">
      <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${currentTier===2?'#10B981':currentTier===1?'#F59E0B':'var(--accent)'};border-radius:99px;transition:width 0.6s ease;"></div>
      <div style="position:absolute;left:${tier1Pct}%;top:50%;transform:translate(-50%,-50%);z-index:2;"><div style="width:20px;height:20px;border-radius:50%;background:${doors>=tier1.doors?'#F59E0B':'#fff'};border:2px solid ${doors>=tier1.doors?'#F59E0B':'#D1D5DB'};display:flex;align-items:center;justify-content:center;font-size:10px;">${doors>=tier1.doors?'✓':''}</div></div>
      <div style="position:absolute;left:calc(100% - 10px);top:50%;transform:translate(-50%,-50%);z-index:2;"><div style="width:20px;height:20px;border-radius:50%;background:${doors>=tier2.doors?'#10B981':'#fff'};border:2px solid ${doors>=tier2.doors?'#10B981':'#D1D5DB'};display:flex;align-items:center;justify-content:center;font-size:10px;">${doors>=tier2.doors?'✓':''}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div style="font-size:11px;color:var(--text-3);">0</div>
      <div style="font-size:11px;color:${doors>=tier1.doors?'#F59E0B':'var(--text-3)'};font-weight:500;text-align:center;">${tier1.label}<br>${tier1.doors} doors</div>
      <div style="font-size:11px;color:${doors>=tier2.doors?'#10B981':'var(--text-3)'};font-weight:500;text-align:right;">${tier2.label}<br>${tier2.doors} doors</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="padding:12px;border-radius:var(--radius);border:2px solid ${currentTier>=1?'#F59E0B':'var(--border)'};background:${currentTier>=1?'#FFFBEB':'var(--bg)'};opacity:${currentTier>=1?'1':'0.5'};"><div style="font-size:11px;font-weight:600;color:${currentTier>=1?'#92400E':'var(--text-3)'};margin-bottom:6px;">🥈 ${tier1.label} · ${tier1.doors} doors</div><div style="font-size:13px;color:var(--text-2);">Sale: <strong style="color:${currentTier>=1?'#92400E':'var(--text-3)'};">${tier1.sale}%</strong></div><div style="font-size:13px;color:var(--text-2);">Purchase: <strong style="color:${currentTier>=1?'#92400E':'var(--text-3)'};">${tier1.purchase}%</strong></div></div>
      <div style="padding:12px;border-radius:var(--radius);border:2px solid ${currentTier>=2?'#10B981':'var(--border)'};background:${currentTier>=2?'#ECFDF5':'var(--bg)'};opacity:${currentTier>=2?'1':'0.5'};"><div style="font-size:11px;font-weight:600;color:${currentTier>=2?'#065F46':'var(--text-3)'};margin-bottom:6px;">🥇 ${tier2.label} · ${tier2.doors} doors</div><div style="font-size:13px;color:var(--text-2);">Sale: <strong style="color:${currentTier>=2?'#065F46':'var(--text-3)'};">${tier2.sale}%</strong></div><div style="font-size:13px;color:var(--text-2);">Purchase: <strong style="color:${currentTier>=2?'#065F46':'var(--text-3)'};">${tier2.purchase}%</strong></div></div>
    </div></div>`;
}
function renderAgentPerformance(el,agentId,agentName) {
  const structure=getBonusStructure(agentName); const currentMonthKey=getMonthKey();
  const {doors,evals}=getVisitsForAgent(agentId,currentMonthKey); const history=getMonthlyHistory(agentId);
  const monthName=new Date().toLocaleDateString("en-CA",{month:"long",year:"numeric"});
  const historyHtml=history.length===0?"":history.map(([mk,stats])=>{
    const struct=getBonusStructure(agentName); const tier=stats.doors>=struct.tiers[1].doors?2:stats.doors>=struct.tiers[0].doors?1:0;
    const tierBadge=tier===2?`<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#ECFDF5;color:#065F46;font-weight:500;">Tier 2 🏆</span>`:tier===1?`<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#FFFBEB;color:#92400E;font-weight:500;">Tier 1 🥈</span>`:`<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--bg);color:var(--text-3);">No tier</span>`;
    const d=new Date(mk+"-01"); const label=d.toLocaleDateString("en-CA",{month:"long",year:"numeric"});
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);"><div style="flex:1;font-size:13px;font-weight:500;">${label}</div><div style="font-size:12px;color:var(--text-2);">${stats.doors} doors · ${stats.evals} evals</div>${tierBadge}</div>`;
  }).join("");
  el.innerHTML=`<div style="margin-bottom:16px;"><div style="font-size:13px;color:var(--text-2);">${monthName} · ${evals} evaluation${evals!==1?"s":""} booked</div></div>${renderTierMeter(doors,structure)}${history.length?`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;"><div class="section-title" style="margin-bottom:12px;">Monthly history</div>${historyHtml}</div>`:""}`;
}
function renderAdminPerformance(el) {
  if (!allUsers.length) { el.innerHTML=`<div class="empty-state"><div class="empty-icon">◎</div><div class="empty-title">No agents yet</div></div>`; return; }
  const currentMonthKey=getMonthKey(); const monthName=new Date().toLocaleDateString("en-CA",{month:"long",year:"numeric"});
  const agentsHtml=allUsers.map(u=>{
    const {doors,evals}=getVisitsForAgent(u.uid,currentMonthKey); const structure=getBonusStructure(u.name);
    const tier=doors>=structure.tiers[1].doors?2:doors>=structure.tiers[0].doors?1:0;
    const tierBadge=tier===2?`<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#ECFDF5;color:#065F46;font-weight:500;">Tier 2 🏆</span>`:tier===1?`<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#FFFBEB;color:#92400E;font-weight:500;">Tier 1 🥈</span>`:`<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:var(--bg);color:var(--text-3);">No tier</span>`;
    const maxDoors=structure.tiers[1].doors; const pct=Math.min((doors/maxDoors)*100,100); const tier1Pct=(structure.tiers[0].doors/maxDoors)*100;
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><div class="agent-avatar">${(u.name||"?").slice(0,2).toUpperCase()}</div><div style="flex:1;"><div style="font-size:14px;font-weight:600;">${u.name||u.email}</div><div style="font-size:12px;color:var(--text-3);">${doors} doors · ${evals} evals this month</div></div>${tierBadge}</div><div style="position:relative;height:14px;background:var(--bg);border-radius:99px;overflow:visible;margin-bottom:8px;"><div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${tier===2?'#10B981':tier===1?'#F59E0B':'var(--accent)'};border-radius:99px;transition:width 0.6s;"></div><div style="position:absolute;left:${tier1Pct}%;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:${doors>=structure.tiers[0].doors?'#F59E0B':'#fff'};border:2px solid ${doors>=structure.tiers[0].doors?'#F59E0B':'#D1D5DB'};"></div><div style="position:absolute;left:calc(100% - 7px);top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:${doors>=structure.tiers[1].doors?'#10B981':'#fff'};border:2px solid ${doors>=structure.tiers[1].doors?'#10B981':'#D1D5DB'};"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);"><span>0</span><span>${structure.tiers[0].doors} (T1)</span><span>${structure.tiers[1].doors} (T2)</span></div></div>`;
  }).join("");
  el.innerHTML=`<div style="font-size:13px;color:var(--text-2);margin-bottom:16px;">${monthName} — all agents</div>${agentsHtml}`;
}
function updateProspectCount() { document.getElementById("prospectCount").textContent=`${allProspects.length} expired listing${allProspects.length!==1?"s":""}`; }


// ── Filter bar & prospects rendering (unchanged) ───────────
function renderFilterBar() {
  const bar=document.getElementById("filterBar"); if (!bar) return;
  const hasFilters=activeFilters.sort!=="newest"||activeFilters.mailing!=="all"||activeFilters.visit!=="all"||activeFilters.eval!=="all"||activeFilters.type!=="all";
  const hasMuni=selectedMunicipalities.size>0; const isFilterOpen=bar.dataset.filterOpen==="true"; const isMuniOpen=bar.dataset.muniOpen==="true";
  const btn=(label,key,val,icon)=>{const active=activeFilters[key]===val;return`<button onclick="setFilter('${key}','${val}')" style="padding:6px 12px;border-radius:99px;font-size:12px;font-family:var(--font);cursor:pointer;white-space:nowrap;border:1px solid ${active?'var(--accent)':'var(--border-med)'};background:${active?'var(--accent)':'var(--surface)'};color:${active?'#fff':'var(--text-2)'};font-weight:${active?'500':'400'};transition:all 0.15s;">${icon?icon+' ':''}${label}</button>`;};
  const municipalities=getMunicipalities();
  const muniButtons=municipalities.map(m=>{const active=selectedMunicipalities.has(m);return`<button onclick="toggleMunicipality('${m.replace(/'/g,"\\'")}')" style="padding:6px 12px;border-radius:99px;font-size:12px;font-family:var(--font);cursor:pointer;white-space:nowrap;border:1px solid ${active?'var(--accent)':'var(--border-med)'};background:${active?'var(--accent)':'var(--surface)'};color:${active?'#fff':'var(--text-2)'};font-weight:${active?'500':'400'};transition:all 0.15s;">${active?'✓ ':''}${m}</button>`;}).join("");
  bar.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:${isFilterOpen||isMuniOpen?'0':'16px'};">
    <button onclick="toggleFilterPanel()" style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:99px;font-size:13px;font-family:var(--font);cursor:pointer;border:1px solid ${hasFilters?'var(--accent)':'var(--border-med)'};background:${hasFilters?'var(--accent-light)':'var(--surface)'};color:${hasFilters?'var(--accent)':'var(--text-2)'};font-weight:${hasFilters?'500':'400'};">⚙ Filters${hasFilters?' (active)':''} <span style="font-size:10px;">${isFilterOpen?'▲':'▼'}</span></button>
    <button onclick="toggleMuniPanel()" style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:99px;font-size:13px;font-family:var(--font);cursor:pointer;border:1px solid ${hasMuni?'var(--accent)':'var(--border-med)'};background:${hasMuni?'var(--accent-light)':'var(--surface)'};color:${hasMuni?'var(--accent)':'var(--text-2)'};font-weight:${hasMuni?'500':'400'};">📍 Municipality${hasMuni?` (${selectedMunicipalities.size})`:''} <span style="font-size:10px;">${isMuniOpen?'▲':'▼'}</span></button>
    ${hasFilters||hasMuni?`<button onclick="resetAll()" style="padding:7px 12px;border-radius:99px;font-size:12px;font-family:var(--font);cursor:pointer;border:1px solid var(--red-bg);background:var(--red-bg);color:var(--red);font-weight:500;">✕ Reset all</button>`:""}
  </div>
  ${isFilterOpen?`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:10px;background:var(--surface);">
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Type</span>${btn("All","type","all","")}${btn("Condo","type","condo","🏢")}${btn("House","type","house","🏠")}
    <span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Sort</span>${btn("Newest","sort","newest","↓")}${btn("Oldest","sort","oldest","↑")}${btn("Price ↑","sort","price_asc","")}${btn("Price ↓","sort","price_desc","")}
    <span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Mailers</span>${btn("All","mailing","all","")}${btn("None sent","mailing","none","✉️")}${btn("1–3 sent","mailing","partial","")}${btn("All 4 sent","mailing","complete","✅")}
    <span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Visits</span>${btn("All","visit","all","")}${btn("Not visited","visit","none","")}${btn("Visited","visit","some","🚪")}
    <span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>
    <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-right:2px;">Status</span>${btn("All","eval","all","")}${btn("Eval booked","eval","booked","📅")}${btn("Contacted","eval","contacted","☎️")}${btn("No contact","eval","none","")}
  </div>`:""}
  ${isMuniOpen?`<div style="padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:10px;background:var(--surface);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);">Select municipalities</span>${selectedMunicipalities.size>0?`<button onclick="clearMunicipalities()" style="font-size:11px;color:var(--red);background:none;border:none;cursor:pointer;">Clear all</button>`:""}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${municipalities.length===0?'<span style="font-size:13px;color:var(--text-3);">No municipalities found.</span>':muniButtons}</div>
  </div>`:""}
  ${isFilterOpen||isMuniOpen?'<div style="margin-bottom:16px;"></div>':""}`;
}
window.toggleFilterPanel=function(){const bar=document.getElementById("filterBar");bar.dataset.filterOpen=bar.dataset.filterOpen==="true"?"false":"true";bar.dataset.muniOpen="false";renderFilterBar();};
window.toggleMuniPanel=function(){const bar=document.getElementById("filterBar");bar.dataset.muniOpen=bar.dataset.muniOpen==="true"?"false":"true";bar.dataset.filterOpen="false";renderFilterBar();};
window.toggleMunicipality=function(m){if(selectedMunicipalities.has(m))selectedMunicipalities.delete(m);else selectedMunicipalities.add(m);renderFilterBar();renderProspects();};
window.clearMunicipalities=function(){selectedMunicipalities.clear();renderFilterBar();renderProspects();};
window.setFilter=function(key,val){activeFilters[key]=val;renderFilterBar();renderProspects();};
window.resetAll=function(){activeFilters={sort:"newest",mailing:"all",visit:"all",eval:"all",type:"all"};selectedMunicipalities.clear();const bar=document.getElementById("filterBar");if(bar){bar.dataset.filterOpen="false";bar.dataset.muniOpen="false";}renderFilterBar();renderProspects();};
window.resetFilters=window.resetAll;
function getFilteredAndSorted() {
  const q=document.getElementById("searchInput").value.toLowerCase(); let list=[...allProspects];
  if(q)list=list.filter(p=>{const names=(p.owners||[]).map(o=>o.name).join(" ").toLowerCase();return p.mls?.includes(q)||p.listingAddress?.toLowerCase().includes(q)||names.includes(q);});
  if(activeFilters.type!=="all")list=list.filter(p=>detectPropertyType(p.listingAddress)===activeFilters.type);
  if(selectedMunicipalities.size>0)list=list.filter(p=>selectedMunicipalities.has(extractMunicipality(p.listingAddress)));
  if(activeFilters.mailing!=="all")list=list.filter(p=>{const sent=(p.mail||[]).filter(Boolean).length;if(activeFilters.mailing==="none")return sent===0;if(activeFilters.mailing==="partial")return sent>=1&&sent<=3;if(activeFilters.mailing==="complete")return sent===4;});
  if(activeFilters.visit!=="all")list=list.filter(p=>{const visits=(p.visits||[]).length;if(activeFilters.visit==="none")return visits===0;if(activeFilters.visit==="some")return visits>0;});
  if(activeFilters.eval!=="all")list=list.filter(p=>{const evalBooked=(p.visits||[]).some(v=>v.evalBooked==="yes");const contacted=(p.visits||[]).some(v=>v.contact==="yes");if(activeFilters.eval==="booked")return evalBooked;if(activeFilters.eval==="contacted")return contacted&&!evalBooked;if(activeFilters.eval==="none")return!contacted&&!evalBooked;});
  list.sort((a,b)=>{if(activeFilters.sort==="newest")return(b.expiry||"").localeCompare(a.expiry||"");if(activeFilters.sort==="oldest")return(a.expiry||"").localeCompare(b.expiry||"");if(activeFilters.sort==="price_asc")return(a.lastPrice||0)-(b.lastPrice||0);if(activeFilters.sort==="price_desc")return(b.lastPrice||0)-(a.lastPrice||0);return 0;});
  return list;
}
window.renderProspects=function(){
  renderFilterBar(); const filtered=getFilteredAndSorted(); const container=document.getElementById("prospectsContainer");
  const hasActive=activeFilters.sort!=="newest"||activeFilters.mailing!=="all"||activeFilters.visit!=="all"||activeFilters.eval!=="all"||activeFilters.type!=="all"||selectedMunicipalities.size>0;
  const dupIds=dupReviewMode?new Set(getDupProspects().map(p=>p.id)):new Set();
  if(!filtered.length){container.innerHTML=`<div class="empty-state"><div class="empty-icon">◎</div><div class="empty-title">${hasActive?"No prospects match these filters":"No prospects found"}</div><div class="empty-sub">${hasActive?'<button onclick="resetAll()" style="margin-top:8px;padding:6px 14px;border-radius:99px;background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer;">Reset all filters</button>':allProspects.length===0&&isAdmin?"Add your first prospect using the button above.":"Try a different search."}</div></div>`;return;}
  container.innerHTML=`<div class="prospects-grid">${filtered.map(p=>prospectCard(p,dupIds.has(p.id))).join("")}</div>`;
};
function prospectCard(p,isDup) {
  const initials=(p.owners?.[0]?.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const lastPrice=p.lastPrice?"$"+Number(p.lastPrice).toLocaleString("fr-CA"):"—";
  const priceDrop=p.prevPrice?`<span class="price-drop">↓ from $${Number(p.prevPrice).toLocaleString("fr-CA")}</span>`:"";
  const mailings=(p.mail||[]).filter(Boolean).length; const visits=(p.visits||[]).length;
  const evalBooked=(p.visits||[]).some(v=>v.evalBooked==="yes"); const contacted=(p.visits||[]).some(v=>v.contact==="yes");
  const propType=detectPropertyType(p.listingAddress); const municipality=extractMunicipality(p.listingAddress);
  const isTargeted=todaysTargets.includes(p.id);
  const statusBadge=evalBooked?`<span class="badge badge-green">Eval booked</span>`:contacted?`<span class="badge badge-blue">Contacted</span>`:mailings>0?`<span class="badge badge-amber">${mailings} mailing${mailings>1?"s":""} sent</span>`:`<span class="badge badge-gray">Not contacted</span>`;
  const typeBadge=propType==="condo"?`<span class="badge" style="background:#EEEDFE;color:#3C3489;">🏢 Condo</span>`:`<span class="badge" style="background:#EAF3DE;color:#2D6A4F;">🏠 House</span>`;
  const dupBadge=isDup?`<span class="badge" style="background:var(--amber-bg);color:var(--amber);">⚠ Potential duplicate</span>`:"";
  const cardBg=isDup&&dupReviewMode?'border-color:#E9A000;background:#FDF3E7;':isTargeted?'border-color:var(--accent);':"";
  const targetBtn=`<button onclick="event.stopPropagation();toggleTarget('${p.id}')" title="${isTargeted?"Remove from Today's Targets":"Add to Today's Targets"}" style="position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;border:none;background:${isTargeted?'var(--accent)':'var(--border)'};color:${isTargeted?'#fff':'var(--text-3)'};font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;">🎯</button>`;
  const clickFn=dupReviewMode?"":exportMode?`toggleSelectProspect('${p.mls}')`:`openProspectModal('${p.id}')`;
  return `<div class="prospect-card" onclick="${clickFn}" style="position:relative;${cardBg}">${targetBtn}<div class="card-top"><div class="card-avatar">${initials}</div><div class="card-main"><div class="card-name" style="padding-right:32px;">${(p.owners||[]).map(o=>o.name).join(", ")}</div><div class="card-addr">${p.owners?.[0]?.street||""}, ${p.owners?.[0]?.city||""}</div><div class="card-mls">MLS #${p.mls} · Expires ${p.expiry||"—"} · 📍 ${municipality}</div></div></div><div class="card-meta">${statusBadge}${typeBadge}${dupBadge}<span class="badge badge-red">${p.status||"Expiré"}</span></div><div class="card-tracking"><div class="track-item"><div class="track-label">Last price</div><div class="track-value">${lastPrice} ${priceDrop}</div></div><div class="track-item"><div class="track-label">Mailings</div><div class="track-value">${mailings}/4</div></div><div class="track-item"><div class="track-label">Visits</div><div class="track-value">${visits}</div></div></div></div>`;
}
window.startDupReview=function(){const groups=getDupGroups();if(!Object.keys(groups).length){showToast("No duplicates found");return;}dupReviewMode=true;selectedMLS.clear();renderProspects();showDupReviewModal(groups);};
window.cancelDupReview=function(){dupReviewMode=false;selectedMLS.clear();renderProspects();const banner=document.getElementById("dupBanner");if(banner)banner.style.display="none";};
function showDupReviewModal(groups) {
  const groupKeys=Object.keys(groups);
  const groupsHtml=groupKeys.map(mls=>{
    const pair=groups[mls]; const master=pair[0]; const dupes=pair.slice(1);
    const masterName=(master.owners||[]).map(o=>o.name).join(", ")||"Unknown";
    const masterMail=(master.mail||[]).filter(Boolean).length; const masterVisits=(master.visits||[]).length;
    const dupesHtml=dupes.map(d=>{const dName=(d.owners||[]).map(o=>o.name).join(", ")||"Unknown";const dMail=(d.mail||[]).filter(Boolean).length;const dVisits=(d.visits||[]).length;return`<div style="background:#FDF3E7;border:1px solid #E9A000;border-radius:8px;padding:10px 12px;margin-top:8px;"><div style="font-size:12px;font-weight:500;color:#7A4F1D;margin-bottom:4px;">Duplicate — will be merged then deleted</div><div style="font-size:13px;font-weight:500;">${dName}</div><div style="font-size:12px;color:var(--text-3);">Added ${d.createdAt?.toDate?d.createdAt.toDate().toLocaleDateString("en-CA"):"—"} · ${dMail} mailings · ${dVisits} visits</div><div style="display:flex;gap:8px;margin-top:8px;"><button onclick="mergeProspects('${master.id}','${d.id}')" style="flex:1;padding:7px;border-radius:6px;background:var(--accent);color:#fff;border:none;font-size:12px;font-family:var(--font);cursor:pointer;font-weight:500;">⇒ Merge into master</button><button onclick="deleteSingleDup('${d.id}')" style="padding:7px 10px;border-radius:6px;background:var(--red-bg);color:var(--red);border:none;font-size:12px;font-family:var(--font);cursor:pointer;">Delete only</button></div></div>`;}).join("");
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;background:var(--surface);"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);margin-bottom:6px;">MLS #${mls}</div><div style="background:var(--accent-light);border:1px solid var(--accent);border-radius:8px;padding:10px 12px;margin-bottom:4px;"><div style="font-size:12px;font-weight:500;color:var(--accent);margin-bottom:4px;">✓ Master — will be kept</div><div style="font-size:13px;font-weight:500;">${masterName}</div><div style="font-size:12px;color:var(--text-3);">Added ${master.createdAt?.toDate?master.createdAt.toDate().toLocaleDateString("en-CA"):"—"} · ${masterMail} mailings · ${masterVisits} visits</div></div>${dupesHtml}</div>`;
  }).join("");
  document.getElementById("prospectModalContent").innerHTML=`<div class="modal-header"><div><div class="modal-title">Review Duplicates</div><div class="modal-sub">${groupKeys.length} MLS number${groupKeys.length!==1?"s":""} with duplicates</div></div><button class="close-x" onclick="closeDupModal()">×</button></div><div style="background:var(--accent-light);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--accent);line-height:1.6;"><strong>How merging works:</strong> The oldest record becomes the master. Visits and mailing dates from all duplicates are combined, then duplicates are deleted.</div><div style="margin-bottom:12px;"><button onclick="mergeAllDuplicates()" style="width:100%;padding:10px;border-radius:8px;background:var(--accent);color:#fff;border:none;font-size:13px;font-family:var(--font);cursor:pointer;font-weight:500;">⇒ Merge all duplicates automatically</button></div>${groupsHtml}<div class="modal-actions"><button class="btn-secondary" onclick="closeDupModal()">Done</button></div>`;
  openModal("prospectModal");
}
window.closeDupModal=function(){dupReviewMode=false;renderProspects();const banner=document.getElementById("dupBanner");if(banner)banner.style.display="none";document.getElementById("modalOverlay").classList.remove("open");document.querySelectorAll(".modal").forEach(m=>m.classList.remove("active"));};
function mergeMail(m1,m2){const r=["","","",""];for(let i=0;i<4;i++)r[i]=m1[i]||m2[i]||"";return r;}
window.mergeProspects=async function(masterId,dupId){const master=allProspects.find(p=>p.id===masterId);const dup=allProspects.find(p=>p.id===dupId);if(!master||!dup)return;const mergedMail=mergeMail(master.mail||["","","",""],dup.mail||["","","",""]);const mergedVisits=[...(master.visits||[]),...(dup.visits||[])];await updateDoc(doc(db,"prospects",masterId),{mail:mergedMail,visits:mergedVisits});await deleteDoc(doc(db,"prospects",dupId));showToast("Merged successfully");const groups=getDupGroups();if(!Object.keys(groups).length){closeDupModal();showToast("All duplicates resolved!");}else showDupReviewModal(groups);};
window.deleteSingleDup=async function(dupId){if(!confirm("Delete this duplicate without merging?"))return;await deleteDoc(doc(db,"prospects",dupId));showToast("Deleted");const groups=getDupGroups();if(!Object.keys(groups).length)closeDupModal();else showDupReviewModal(groups);};
window.mergeAllDuplicates=async function(){if(!confirm("Merge all duplicate groups automatically?"))return;const groups=getDupGroups();let merged=0;for(const mls of Object.keys(groups)){const group=groups[mls];const master=group[0];const dupes=group.slice(1);let mergedMail=master.mail||["","","",""];let mergedVisits=[...(master.visits||[])];for(const dup of dupes){mergedMail=mergeMail(mergedMail,dup.mail||["","","",""]);mergedVisits=[...mergedVisits,...(dup.visits||[])];}await updateDoc(doc(db,"prospects",master.id),{mail:mergedMail,visits:mergedVisits});for(const dup of dupes){await deleteDoc(doc(db,"prospects",dup.id));merged++;}}closeDupModal();showToast(`Merged and removed ${merged} duplicate${merged!==1?"s":""}`);};
window.openProspectModal=async function(id){if(exportMode||dupReviewMode)return;const p=allProspects.find(x=>x.id===id);if(!p)return;renderProspectModal(p);openModal("prospectModal");};
function renderProspectModal(p) {
  const fmt=n=>n?"$"+Number(n).toLocaleString("fr-CA"):"—"; const propType=detectPropertyType(p.listingAddress); const municipality=extractMunicipality(p.listingAddress); const isTargeted=todaysTargets.includes(p.id);
  const ownersHtml=(p.owners||[]).map(o=>`<div class="owner-block"><div class="on">${o.name}</div><div class="oa">${o.street}<br>${o.city} &nbsp;${o.postal}</div></div>`).join("");
  const mailHtml=[0,1,2,3].map(i=>`<div class="mail-slot"><label>Mailing ${i+1}</label><input type="date" value="${(p.mail||[])[i]||""}" onchange="updateMailDate('${p.id}',${i},this.value)" /></div>`).join("");
  const visits=p.visits||[]; const visitRows=visits.length===0?`<p style="font-size:13px;color:var(--text-3);padding:8px 0;">No visits logged yet.</p>`:`<div class="visit-col-labels"><span>Date</span><span>Contact?</span><span>Eval?</span><span></span></div>`+visits.map((v,i)=>`<div class="visit-entry"><input type="date" value="${v.date||""}" onchange="updateVisitField('${p.id}',${i},'date',this.value)" /><button class="yn-btn ${v.contact==='yes'?'yes':v.contact==='no'?'no':''}" onclick="cycleVisitField('${p.id}',${i},'contact')">${v.contact==='yes'?'✓':v.contact==='no'?'✕':'—'}<span class="yn-label">Contact</span></button><button class="yn-btn ${v.evalBooked==='yes'?'yes':v.evalBooked==='no'?'no':''}" onclick="cycleVisitField('${p.id}',${i},'evalBooked')">${v.evalBooked==='yes'?'✓':v.evalBooked==='no'?'✕':'—'}<span class="yn-label">Eval</span></button><button class="icon-btn red" onclick="removeVisit('${p.id}',${i})">✕</button></div>`).join("");
  const adminActions=isAdmin?`<div class="modal-section"><div class="modal-section-title">Admin</div><button class="btn-danger" onclick="deleteProspect('${p.id}')">Delete prospect</button></div>`:"";
  document.getElementById("prospectModalContent").innerHTML=`<div class="modal-header"><div><div class="modal-title">${(p.owners||[]).map(o=>o.name).join(", ")}</div><div class="modal-sub">MLS #${p.mls} · ${p.listingAddress||""}</div></div><button class="close-x" onclick="closeAllModals()">×</button></div><div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">${propType==="condo"?'<span class="badge" style="background:#EEEDFE;color:#3C3489;">🏢 Condo</span>':'<span class="badge" style="background:#EAF3DE;color:#2D6A4F;">🏠 House</span>'}<span class="badge badge-gray">📍 ${municipality}</span><button onclick="toggleTarget('${p.id}')" style="margin-left:auto;padding:6px 12px;border-radius:99px;border:1px solid ${isTargeted?'var(--accent)':'var(--border-med)'};background:${isTargeted?'var(--accent)':'var(--surface)'};color:${isTargeted?'#fff':'var(--text-2)'};font-size:12px;font-family:var(--font);cursor:pointer;">🎯 ${isTargeted?"In Today's Targets":"Add to Today's Targets"}</button></div><div class="detail-grid"><div class="detail-field"><div class="lbl">Last price</div><div class="val">${fmt(p.lastPrice)}</div></div><div class="detail-field"><div class="lbl">Original price</div><div class="val">${fmt(p.origPrice)}</div></div><div class="detail-field"><div class="lbl">Contract start</div><div class="val">${p.contractStart||"—"}</div></div><div class="detail-field"><div class="lbl">Expiry</div><div class="val">${p.expiry||"—"}</div></div></div><div class="modal-section"><div class="modal-section-title">Agency &amp; Broker</div><div style="font-size:14px;font-weight:500;">${p.broker||"—"}</div><div style="font-size:13px;color:var(--text-2);">${p.agency||""} · ${p.brokerPhone||""}</div></div><div class="modal-section"><div class="modal-section-title">Owner(s) — Mailing Address</div>${ownersHtml}</div><div class="modal-section"><div class="modal-section-title">Mailing Attempts</div><div class="mail-grid">${mailHtml}</div></div><div class="modal-section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><div class="modal-section-title" style="margin:0;">Door-to-Door Visits</div><button class="btn-secondary" style="font-size:12px;padding:5px 10px;" onclick="addVisit('${p.id}')">+ Add visit</button></div>${visitRows}</div>${adminActions}`;
}
window.updateMailDate=async function(id,idx,val){const p=allProspects.find(x=>x.id===id);if(!p)return;const mail=[...(p.mail||["","","",""])];while(mail.length<4)mail.push("");mail[idx]=val;await updateDoc(doc(db,"prospects",id),{mail});logActivity(id,`Mailing ${idx+1} date set to ${val}`);};
window.updateVisitField=async function(id,idx,field,val){const p=allProspects.find(x=>x.id===id);if(!p)return;const visits=[...(p.visits||[])];visits[idx]={...visits[idx],[field]:val};await updateDoc(doc(db,"prospects",id),{visits});};
window.cycleVisitField=async function(id,idx,field){const p=allProspects.find(x=>x.id===id);if(!p)return;const visits=[...(p.visits||[])];const cur=visits[idx][field];visits[idx]={...visits[idx],[field]:cur==="yes"?"no":cur==="no"?"":"yes"};await updateDoc(doc(db,"prospects",id),{visits});const label=field==="contact"?"Contact made":"Eval booked";if(visits[idx][field]==="yes")logActivity(id,`${label} — marked YES`);renderProspectModal({...p,visits});};
window.addVisit=async function(id){const p=allProspects.find(x=>x.id===id);if(!p)return;const visits=[...(p.visits||[]),{date:"",contact:"",evalBooked:"",agentId:currentUser.uid,agentName:currentUserProfile?.name||currentUser.email}];await updateDoc(doc(db,"prospects",id),{visits});logActivity(id,"Door-to-door visit logged");renderProspectModal({...p,visits});};
window.removeVisit=async function(id,idx){const p=allProspects.find(x=>x.id===id);if(!p)return;const visits=[...(p.visits||[])];visits.splice(idx,1);await updateDoc(doc(db,"prospects",id),{visits});renderProspectModal({...p,visits});};
async function logActivity(prospectId,action){await addDoc(collection(db,"activity"),{prospectId,action,agentId:currentUser.uid,agentName:currentUserProfile?.name||currentUser.email,timestamp:serverTimestamp()});}

window.openAddProspect=function(tab){tab=tab||"single";document.getElementById("addProspectContent").innerHTML=`<div class="modal-header"><div class="modal-title">Add Prospects</div><button class="close-x" onclick="closeAllModals()">×</button></div><div style="display:flex;gap:0;margin-bottom:20px;border:1px solid var(--border-med);border-radius:var(--radius);overflow:hidden;"><button onclick="openAddProspect('single')" style="flex:1;padding:9px;font-size:13px;font-family:var(--font);border:none;cursor:pointer;background:${tab==='single'?'var(--accent)':'var(--surface)'};color:${tab==='single'?'#fff':'var(--text-2)'};">Single Entry</button><button onclick="openAddProspect('bulk')" style="flex:1;padding:9px;font-size:13px;font-family:var(--font);border:none;border-left:1px solid var(--border-med);cursor:pointer;background:${tab==='bulk'?'var(--accent)':'var(--surface)'};color:${tab==='bulk'?'#fff':'var(--text-2)'};">Bulk CSV Import</button></div>${tab==='single'?singleEntryForm():bulkImportForm()}`;openModal("addProspectModal");};
function singleEntryForm(){return`<div class="form-group"><label>MLS #</label><input type="text" id="ap_mls" /></div><div class="form-group"><label>Status</label><select id="ap_status"><option value="Expiré">Expiré</option><option value="Annulé">Annulé</option></select></div><div class="form-group"><label>Listing Address</label><input type="text" id="ap_listingAddr" /></div><div class="form-group"><label>Contract Start</label><input type="date" id="ap_start" /></div><div class="form-group"><label>Expiry Date</label><input type="date" id="ap_expiry" /></div><div class="form-group"><label>Last Price ($)</label><input type="number" id="ap_price" /></div><div class="form-group"><label>Original Price ($)</label><input type="number" id="ap_origPrice" /></div><div class="form-group"><label>Previous Price ($)</label><input type="number" id="ap_prevPrice" /></div><div class="form-group"><label>Agency</label><input type="text" id="ap_agency" /></div><div class="form-group"><label>Broker Name</label><input type="text" id="ap_broker" /></div><div class="form-group"><label>Broker Phone</label><input type="text" id="ap_phone" /></div><hr class="divider" /><p style="font-size:13px;font-weight:500;margin-bottom:12px;">Owner 1 — Mailing Address</p><div class="form-group"><label>Owner Name</label><input type="text" id="ap_o1name" /></div><div class="form-group"><label>Street</label><input type="text" id="ap_o1street" /></div><div class="form-group"><label>City</label><input type="text" id="ap_o1city" /></div><div class="form-group"><label>Postal Code</label><input type="text" id="ap_o1postal" /></div><hr class="divider" /><p style="font-size:13px;font-weight:500;margin-bottom:12px;">Owner 2 (optional)</p><div class="form-group"><label>Owner Name</label><input type="text" id="ap_o2name" /></div><div class="form-group"><label>Street</label><input type="text" id="ap_o2street" /></div><div class="form-group"><label>City</label><input type="text" id="ap_o2city" /></div><div class="form-group"><label>Postal Code</label><input type="text" id="ap_o2postal" /></div><div id="ap_error" class="error-msg" style="display:none;margin-top:8px;"></div><div class="modal-actions"><button class="btn-secondary" onclick="closeAllModals()">Cancel</button><button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="saveNewProspect()">Save Prospect</button></div>`;}
function bulkImportForm(){return`<div style="background:var(--accent-light);border-radius:var(--radius);padding:14px;margin-bottom:16px;"><p style="font-size:13px;font-weight:500;color:var(--accent);margin-bottom:6px;">How it works</p><p style="font-size:12px;color:var(--accent);line-height:1.6;">1. Download the CSV template below<br>2. Fill in your prospects (one per row)<br>3. Save as CSV and upload here</p></div><div style="margin-bottom:16px;"><button class="btn-secondary" style="width:100%;" onclick="downloadTemplate()">↓ Download CSV Template</button></div><div class="form-group"><label>Upload your filled CSV</label><input type="file" id="csvFileInput" accept=".csv" onchange="previewCSV(this)" style="padding:8px;background:var(--bg);" /></div><div id="csvPreview" style="display:none;margin-bottom:16px;"><div style="font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:8px;" id="csvPreviewLabel"></div><div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);" id="csvPreviewList"></div></div><div id="ap_error" class="error-msg" style="display:none;margin-top:8px;"></div><div class="modal-actions"><button class="btn-secondary" onclick="closeAllModals()">Cancel</button><button class="btn-primary" id="importBtn" style="width:auto;padding:9px 20px;display:none;" onclick="runBulkImport()">Import All</button></div>`;}
window.downloadTemplate=function(){const headers="mls,status,listingAddress,contractStart,expiry,lastPrice,origPrice,prevPrice,agency,broker,brokerPhone,owner1Name,owner1Street,owner1City,owner1Postal,owner2Name,owner2Street,owner2City,owner2Postal";const example='9183921,Expiré,"10200 Boul. de Acadie, app. 814, Montréal (Ahuntsic-Cartierville)",2025-09-17,2026-03-31,540000,540000,,LES IMMEUBLES HOME-PRO,Amir Keryakes,514-943-2647,Medhat Azer,10200 Acadie app. 814,Montreal,H4N 3L3,,,,';const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([headers+"\n"+example],{type:"text/csv"}));a.download="prospects-template.csv";a.click();};
let parsedCSVRows=[];window._csvRows=[];window._csvHeaders=[];
window.previewCSV=function(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){try{const rows=parseCSV(e.target.result);if(rows.length<2){showToast("CSV appears empty");return;}const headers=rows[0].map(h=>h.trim().toLowerCase());window._csvHeaders=headers;parsedCSVRows=rows.slice(1).filter(r=>r.some(c=>c.trim()));window._csvRows=parsedCSVRows;const isAlt=headers.includes("mls#")||headers.includes("owner 1 full address");const get=(row,col)=>{const idx=headers.indexOf(col);return idx>=0?(row[idx]||"").trim():"";};const preview=parsedCSVRows.map(row=>{const mls=isAlt?get(row,"mls#"):get(row,"mls");const owner=isAlt?get(row,"owner 1 name"):get(row,"owner1name");const addr=isAlt?get(row,"listing address"):get(row,"listingaddress");const price=isAlt?get(row,"last price"):get(row,"lastprice");const ptype=detectPropertyType(addr);const muni=extractMunicipality(addr);return`<div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><span style="background:var(--accent-light);color:var(--accent);padding:2px 6px;border-radius:4px;font-weight:500;white-space:nowrap;">MLS ${mls}</span><span style="flex:1;">${owner}</span><span style="background:${ptype==='condo'?'#EEEDFE':'#EAF3DE'};color:${ptype==='condo'?'#3C3489':'#2D6A4F'};padding:2px 6px;border-radius:4px;font-size:11px;">${ptype==='condo'?'🏢':'🏠'} ${ptype}</span><span style="color:var(--text-3);font-size:11px;">📍${muni}</span><span style="color:var(--text-3);">$${Number(price).toLocaleString("fr-CA")}</span></div>`;}).join("");document.getElementById("csvPreviewLabel").textContent=parsedCSVRows.length+" prospect(s) ready to import";document.getElementById("csvPreviewList").innerHTML=preview;document.getElementById("csvPreview").style.display="block";document.getElementById("importBtn").style.display="block";}catch(err){showToast("Error reading CSV: "+err.message);}};reader.readAsText(file);};
function parseCSV(text){const rows=[];let row=[];let cell="";let inQ=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&inQ&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){inQ=!inQ;}else if(ch===','&&!inQ){row.push(cell);cell="";}else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell="";}else{cell+=ch;}}if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
function parseOwnerFullAddress(full){if(!full)return{street:"",city:"",postal:""};const postalMatch=full.match(/([A-Z]\d[A-Z]\s*\d[A-Z]\d)\s*$/i);const postal=postalMatch?postalMatch[1].trim():"";const withoutPostal=postalMatch?full.slice(0,postalMatch.index).trim():full;const cityMatch=withoutPostal.match(/,\s*([^,]+)$/);const city=cityMatch?cityMatch[1].trim():"";const street=cityMatch?withoutPostal.slice(0,cityMatch.index).trim():withoutPostal;return{street,city,postal};}
window.runBulkImport=async function(){const btn=document.getElementById("importBtn");try{if(btn){btn.textContent="Importing...";btn.disabled=true;}const rows=window._csvRows||[];if(!rows.length){showToast("No data to import");if(btn){btn.textContent="Import All";btn.disabled=false;}return;}const headers=window._csvHeaders||[];const isAlt=headers.includes("mls#")||headers.includes("owner 1 full address");const get=(row,col)=>{const i=headers.indexOf(col);return i>=0?(row[i]||"").trim():"";};let imported=0;let failed=0;for(const row of rows){try{let mls,status,listingAddress,contractStart,expiry,lastPrice,origPrice,prevPrice,agency,broker,brokerPhone,owners;if(isAlt){mls=get(row,"mls#");status=get(row,"status")||"Expiré";listingAddress=get(row,"listing address");contractStart=get(row,"contract start date");expiry=get(row,"expiry date");lastPrice=Number(get(row,"last price"))||0;origPrice=Number(get(row,"original price"))||0;prevPrice=get(row,"previous price")?Number(get(row,"previous price")):null;agency="";broker="";brokerPhone="";const o1name=get(row,"owner 1 name");const o1addr=parseOwnerFullAddress(get(row,"owner 1 full address"));owners=o1name?[{name:o1name,street:o1addr.street,city:o1addr.city,postal:o1addr.postal}]:[];const o2name=get(row,"owner 2 name");if(o2name){const o2addr=parseOwnerFullAddress(get(row,"owner 2 full address")||"");owners.push({name:o2name,street:o2addr.street,city:o2addr.city,postal:o2addr.postal});}}else{mls=get(row,"mls");status=get(row,"status")||"Expiré";listingAddress=get(row,"listingaddress");contractStart=get(row,"contractstart");expiry=get(row,"expiry");lastPrice=Number(get(row,"lastprice"))||0;origPrice=Number(get(row,"origprice"))||0;prevPrice=get(row,"prevprice")?Number(get(row,"prevprice")):null;agency=get(row,"agency");broker=get(row,"broker");brokerPhone=get(row,"brokerphone");owners=[{name:get(row,"owner1name"),street:get(row,"owner1street"),city:get(row,"owner1city"),postal:get(row,"owner1postal")}];if(get(row,"owner2name"))owners.push({name:get(row,"owner2name"),street:get(row,"owner2street"),city:get(row,"owner2city"),postal:get(row,"owner2postal")});}if(!mls||!owners.length||!owners[0].name){failed++;continue;}await addDoc(collection(db,"prospects"),{mls,status,listingAddress,contractStart,expiry,lastPrice,origPrice,prevPrice,agency,broker,brokerPhone,owners,mail:["","","",""],visits:[],createdAt:serverTimestamp(),createdBy:currentUser.uid});imported++;}catch(e){failed++;}}closeAllModals();showToast(`Imported ${imported} prospect(s)${failed?` · ${failed} failed`:""}`);}catch(err){showToast("Import error: "+err.message);if(btn){btn.textContent="Import All";btn.disabled=false;}}};
window.saveNewProspect=async function(){const g=id=>document.getElementById(id)?.value?.trim();const mls=g("ap_mls");const o1name=g("ap_o1name");if(!mls||!o1name){const e=document.getElementById("ap_error");e.textContent="MLS # and at least one owner name are required.";e.style.display="block";return;}const owners=[{name:o1name,street:g("ap_o1street"),city:g("ap_o1city"),postal:g("ap_o1postal")}];if(g("ap_o2name"))owners.push({name:g("ap_o2name"),street:g("ap_o2street"),city:g("ap_o2city"),postal:g("ap_o2postal")});await addDoc(collection(db,"prospects"),{mls,status:g("ap_status"),listingAddress:g("ap_listingAddr"),contractStart:g("ap_start"),expiry:g("ap_expiry"),lastPrice:Number(g("ap_price"))||0,origPrice:Number(g("ap_origPrice"))||0,prevPrice:g("ap_prevPrice")?Number(g("ap_prevPrice")):null,agency:g("ap_agency"),broker:g("ap_broker"),brokerPhone:g("ap_phone"),owners,mail:["","","",""],visits:[],createdAt:serverTimestamp(),createdBy:currentUser.uid});closeAllModals();showToast("Prospect added successfully");};
window.deleteProspect=async function(id){if(!confirm("Delete this prospect? This cannot be undone."))return;await deleteDoc(doc(db,"prospects",id));closeAllModals();showToast("Prospect deleted");};
window.startExportMode=function(){exportMode=true;selectedMLS.clear();document.getElementById("selBanner").classList.add("active");document.getElementById("exportModeBtn").style.display="none";renderProspects();};
window.cancelExportMode=function(){exportMode=false;selectedMLS.clear();document.getElementById("selBanner").classList.remove("active");document.getElementById("exportModeBtn").style.display="";renderProspects();};
window.toggleSelectProspect=function(mls){if(selectedMLS.has(mls))selectedMLS.delete(mls);else selectedMLS.add(mls);updateSelBanner();renderProspects();};
window.selectAllProspects=function(){allProspects.forEach(p=>selectedMLS.add(p.mls));updateSelBanner();renderProspects();};
window.clearSelection=function(){selectedMLS.clear();updateSelBanner();renderProspects();};
function updateSelBanner(){const n=selectedMLS.size;document.getElementById("selText").textContent=`${n} prospect${n!==1?"s":""} selected`;document.getElementById("confirmExportBtn").disabled=n===0;}
window.showExportConfirm=function(){const sel=allProspects.filter(p=>selectedMLS.has(p.mls));let num=0;const items=sel.map(p=>(p.owners||[]).map(o=>{num++;return`<div class="export-item"><div class="export-num">${num}</div><div><div class="export-item-name">${o.name}</div><div class="export-item-addr">${o.street}, ${o.city} ${o.postal}</div></div></div>`;}).join("")).join("");const totalLabels=sel.reduce((s,p)=>s+(p.owners||[]).length,0);document.getElementById("exportModalContent").innerHTML=`<div class="modal-header"><div class="modal-title">Confirm export</div><button class="close-x" onclick="closeAllModals()">×</button></div><p style="font-size:13px;color:var(--text-2);">${sel.length} prospect${sel.length!==1?"s":""} · ${totalLabels} mailing label${totalLabels!==1?"s":""}</p><div class="export-list">${items}</div><div class="modal-actions"><button class="btn-secondary" onclick="closeAllModals()">Back</button><button class="btn-confirm" onclick="doExport()">Download CSV ↓</button></div>`;openModal("exportModal");};
window.doExport=function(){const sel=allProspects.filter(p=>selectedMLS.has(p.mls));const rows=[["Name","Street","City","Province","Postal Code"]];sel.forEach(p=>{(p.owners||[]).forEach(o=>{if(!o.name)return;rows.push([o.name,o.street||"",o.city?.replace(/ \(.*\)/,"").trim()||"","QC",o.postal||""]);});});const csv=rows.map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));a.download="mailing_labels.csv";a.click();closeAllModals();cancelExportMode();showToast("Export downloaded");};

async function renderDashboard() {
  const el=document.getElementById("dashboardContent");if(!el)return;
  const totalProspects=allProspects.length;const condos=allProspects.filter(p=>detectPropertyType(p.listingAddress)==="condo").length;const houses=allProspects.filter(p=>detectPropertyType(p.listingAddress)==="house").length;
  const totalMailings=allProspects.reduce((s,p)=>s+(p.mail||[]).filter(Boolean).length,0);const totalVisits=allProspects.reduce((s,p)=>s+(p.visits||[]).length,0);
  const evalsBooked=allProspects.filter(p=>(p.visits||[]).some(v=>v.evalBooked==="yes")).length;const contacted=allProspects.filter(p=>(p.visits||[]).some(v=>v.contact==="yes")).length;
  const dupCount=getDupProspects().length;
  const activeOpsL=opsListings.filter(l=>l.status==="offre"&&(l.offers||[]).some(o=>o.status==="accepted")).length;
  const activeOpsP=opsPurchases.length;
  let activityHtml='<p style="font-size:13px;color:var(--text-3);">No activity yet.</p>';
  try{const actSnap=await getDocs(query(collection(db,"activity"),orderBy("timestamp","desc")));const acts=actSnap.docs.slice(0,15).map(d=>d.data());if(acts.length)activityHtml=acts.map(a=>{const prospect=allProspects.find(p=>p.id===a.prospectId);const pName=prospect?(prospect.owners?.[0]?.name||"MLS #"+prospect.mls):"Unknown";const ts=a.timestamp?.toDate?a.timestamp.toDate().toLocaleDateString("en-CA"):"";return`<div class="activity-item"><div class="activity-dot"></div><div><div class="activity-text"><strong>${a.agentName||"Agent"}</strong> — ${a.action} on <em>${pName}</em></div><div class="activity-time">${ts}</div></div></div>`;}).join("");}catch(e){}
  const agentStats={};allProspects.forEach(p=>{(p.visits||[]).forEach(v=>{const aid=v.agentId||"unknown";const aname=v.agentName||"Unknown";if(!agentStats[aid])agentStats[aid]={name:aname,visits:0,contacts:0,evals:0};agentStats[aid].visits++;if(v.contact==="yes")agentStats[aid].contacts++;if(v.evalBooked==="yes")agentStats[aid].evals++;});});
  const agentCardsHtml=Object.values(agentStats).length===0?'<p style="font-size:13px;color:var(--text-3);">No visit activity logged yet.</p>':Object.values(agentStats).map(a=>`<div class="agent-card"><div class="agent-header"><div class="agent-avatar">${a.name.slice(0,2).toUpperCase()}</div><div><div class="agent-name">${a.name}</div></div></div><div class="agent-stats"><div class="agent-stat"><div class="agent-stat-num">${a.visits}</div><div class="agent-stat-lbl">Visits</div></div><div class="agent-stat"><div class="agent-stat-num">${a.contacts}</div><div class="agent-stat-lbl">Contacts</div></div><div class="agent-stat"><div class="agent-stat-num">${a.evals}</div><div class="agent-stat-lbl">Evals</div></div></div></div>`).join("");
  el.innerHTML=`<div class="stats-grid"><div class="stat-card"><div class="stat-label">Total prospects</div><div class="stat-value">${totalProspects}</div></div><div class="stat-card"><div class="stat-label">🏢 Condos</div><div class="stat-value">${condos}</div></div><div class="stat-card"><div class="stat-label">🏠 Houses</div><div class="stat-value">${houses}</div></div><div class="stat-card"><div class="stat-label">Mailings sent</div><div class="stat-value">${totalMailings}</div></div><div class="stat-card"><div class="stat-label">Door visits</div><div class="stat-value">${totalVisits}</div></div><div class="stat-card"><div class="stat-label">Contacts made</div><div class="stat-value">${contacted}</div></div><div class="stat-card"><div class="stat-label">Evals booked</div><div class="stat-value">${evalsBooked}</div></div><div class="stat-card" style="border-color:#0C2B5E;background:#E8EDF7;"><div class="stat-label" style="color:#0C2B5E;">◩ Ops — Dossiers actifs</div><div class="stat-value" style="color:#0C2B5E;">${activeOpsL+activeOpsP}</div><div class="stat-sub" style="color:#0C2B5E;">${activeOpsL} inscriptions · ${activeOpsP} achats</div></div>${dupCount>0?`<div class="stat-card" style="border-color:#E9A000;background:#FDF3E7;cursor:pointer;" onclick="switchView('prospects',null);startDupReview()"><div class="stat-label" style="color:#7A4F1D;">⚠ Duplicates</div><div class="stat-value" style="color:#7A4F1D;">${dupCount}</div><div class="stat-sub" style="color:#7A4F1D;">Click to review</div></div>`:""}</div><div class="section-title" style="margin-bottom:12px;">Agent activity</div>${agentCardsHtml}<div class="section-title" style="margin:20px 0 12px;">Recent activity log</div><div class="activity-list">${activityHtml}</div>`;
}
async function loadAllUsers(){const snap=await getDocs(collection(db,"users"));allUsers=snap.docs.map(d=>({uid:d.id,...d.data()}));}
async function renderAdmin(){await loadAllUsers();const el=document.getElementById("adminContent");const usersHtml=allUsers.length===0?'<p style="font-size:13px;color:var(--text-3);">No users yet.</p>':allUsers.map(u=>`<div class="admin-card"><div class="agent-avatar">${(u.name||u.email||"?").slice(0,2).toUpperCase()}</div><div class="admin-card-info"><div class="admin-card-name">${u.name||"—"}</div><div class="admin-card-email">${u.email||""}</div></div><span class="badge ${u.role==='admin'?'badge-blue':'badge-gray'} admin-card-role">${u.role||"agent"}</span></div>`).join("");el.innerHTML=`<div class="section-title" style="margin-bottom:12px;">Team members (${allUsers.length})</div>${usersHtml}<div style="margin-top:24px;padding:16px;background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);"><div class="section-title" style="margin-bottom:8px;">How to add agents</div><p style="font-size:13px;color:var(--text-2);line-height:1.6;">1. Firebase → Authentication → Users → Add user<br>2. Copy UID → Firestore → users collection → Add document<br>3. Document ID = UID, fields: <code>name</code>, <code>email</code>, <code>role: "agent"</code></p></div>`;}
window.openInviteAgent=function(){document.getElementById("inviteModalContent").innerHTML=`<div class="modal-header"><div class="modal-title">Add Agent</div><button class="close-x" onclick="closeAllModals()">×</button></div><ol style="font-size:13px;color:var(--text-2);line-height:2;padding-left:18px;"><li>Go to <strong>Authentication → Users → Add user</strong></li><li>Enter the agent's email and a temporary password</li><li>Copy the UID → Firestore → users collection</li><li>New document: UID as ID, fields: <code>name</code>, <code>email</code>, <code>role: "agent"</code></li></ol><div class="modal-actions"><button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="closeAllModals()">Got it</button></div>`;openModal("inviteModal");};
function openModal(id){document.querySelectorAll(".modal").forEach(m=>m.classList.remove("active"));document.getElementById(id).classList.add("active");document.getElementById("modalOverlay").classList.add("open");}
window.closeAllModals=function(e){if(e&&e.target!==document.getElementById("modalOverlay"))return;document.getElementById("modalOverlay").classList.remove("open");document.querySelectorAll(".modal").forEach(m=>m.classList.remove("active"));};
function showToast(msg){let t=document.querySelector(".toast");if(!t){t=document.createElement("div");t.className="toast";document.body.appendChild(t);}t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500);}
document.addEventListener("click",e=>{if(e.target.classList.contains("close-x")){document.getElementById("modalOverlay").classList.remove("open");document.querySelectorAll(".modal").forEach(m=>m.classList.remove("active"));}});


// ── Activity System ────────────────────────────────────────────────────────

function opsActivityView(l) {
  const acts = opsGetActivity(l.id);
  const visits = acts.filter(a=>a.type==="visit");
  const openHouses = acts.filter(a=>a.type==="openhouse");
  const followUps = acts.filter(a=>a.followUpRequired&&!a.followUpDone);
  const interested = acts.filter(a=>["yes","maybe"].includes(a.offerIntention));
  const secondShowings = acts.filter(a=>a.secondShowing);

  const sourceLabels = {direct:"Direct",agent:"Courtier",immocontact:"Immocontact",realtorca:"Realtor.ca",openhouse:"Visite libre",other:"Autre"};
  const sourceCounts = {};
  acts.forEach(a=>{ const s=a.source||"other"; sourceCounts[s]=(sourceCounts[s]||0)+1; });
  const sourceBar = Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).map(([s,n])=>{
    const pct = Math.round((n/acts.length)*100);
    const colors = {direct:"#1D9E75",agent:"#185FA5",immocontact:"#BA7517",realtorca:"#534AB7",openhouse:"#993C1D",other:"#888780"};
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="font-size:12px;color:var(--text-2);width:100px;flex-shrink:0;">${sourceLabels[s]||s}</div>
      <div style="flex:1;background:var(--bg);border-radius:99px;height:8px;overflow:hidden;">
        <div style="width:${pct}%;height:8px;background:${colors[s]||"#888780"};border-radius:99px;"></div>
      </div>
      <div style="font-size:12px;font-weight:500;color:var(--text-2);width:30px;text-align:right;">${n}</div>
    </div>`;
  }).join("");

  const intentionColors = {yes:"#1D9E75",maybe:"#BA7517",no:"#888780"};
  const intentionLabels = {yes:"Oui",maybe:"Peut-être",no:"Non"};

  const actRows = acts.map(a=>{
    const ic = intentionColors[a.offerIntention]||"#888780";
    const il = intentionLabels[a.offerIntention]||"—";
    const isOH = a.type==="openhouse";
    return `<div class="ops-act-row${a.followUpRequired&&!a.followUpDone?" ops-act-followup":""}">
      <div class="ops-act-left">
        <div class="ops-act-date">${a.date||"—"}</div>
        <span class="ops-act-type-badge ops-act-type-${a.type||"visit"}">${isOH?"Visite libre":"Visite"}</span>
        ${a.secondShowing?`<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:#EEEDFE;color:#534AB7;font-weight:500;">2e visite</span>`:""}
      </div>
      <div class="ops-act-mid">
        <div class="ops-act-name">${a.visitorName||a.agentName||"—"}</div>
        ${a.agentName&&a.visitorName?`<div style="font-size:11px;color:var(--text-3);">${a.agentName}</div>`:""}
        <div style="font-size:11px;color:var(--text-3);">${sourceLabels[a.source]||a.source||""}</div>
      </div>
      ${isOH?`<div class="ops-act-ratings">
        <span style="font-size:12px;color:var(--text-2);">${a.totalVisitors||0} visiteurs · ${a.interestedCount||0} intéressés · ${a.cardsCollected||0} cartes</span>
      </div>`:`<div class="ops-act-ratings">
        ${a.ratings?.overall?`<span class="ops-act-star">⭐ ${a.ratings.overall}/5</span>`:""}
        ${a.ratings?.interior?`<span class="ops-act-star">Int. ${a.ratings.interior}/5</span>`:""}
        ${a.ratings?.price?`<span class="ops-act-star">Prix ${a.ratings.price}/5</span>`:""}
      </div>`}
      <div class="ops-act-right">
        <span style="font-size:12px;font-weight:500;padding:2px 8px;border-radius:99px;background:${ic}20;color:${ic};border:1px solid ${ic}40;">${il}</span>
        ${a.followUpRequired?`<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:${a.followUpDone?"#E1F5EE":"#FAEEDA"};color:${a.followUpDone?"#085041":"#633806"};font-weight:500;">${a.followUpDone?"Suivi fait":"Suivi requis"}</span>`:""}
      </div>
      <div class="ops-act-actions">
        ${a.followUpRequired&&!a.followUpDone?`<button class="ops-offer-btn ops-offer-btn-green" onclick="opsMarkFollowUpDone('${l.id}','${a.id}')">✓ Suivi fait</button>`:""}
        ${a.notes?`<button class="ops-offer-btn" onclick="opsShowNote('${a.id}','${(a.notes||"").replace(/'/g,"\\'")}')">Notes</button>`:""}
        <button class="ops-offer-btn" onclick="opsEditActivity('${l.id}','${a.id}')">Modifier</button>
        <button class="ops-offer-btn ops-offer-btn-red" onclick="opsDeleteActivity('${l.id}','${a.id}')">×</button>
      </div>
    </div>`;
  }).join("");

  const avgRating = (key) => {
    const rated = acts.filter(a=>a.ratings?.[key]);
    if (!rated.length) return "—";
    return (rated.reduce((s,a)=>s+Number(a.ratings[key]),0)/rated.length).toFixed(1);
  };

  return `
    <div class="ops-act-summary">
      <div class="ops-act-kpi"><div class="ops-kpi-l">Visites totales</div><div class="ops-kpi-v">${visits.length}</div></div>
      <div class="ops-act-kpi"><div class="ops-kpi-l">Visites libres</div><div class="ops-kpi-v">${openHouses.length}</div></div>
      <div class="ops-act-kpi"><div class="ops-kpi-l">Intéressés</div><div class="ops-kpi-v" style="color:#1D9E75;">${interested.length}</div></div>
      <div class="ops-act-kpi"><div class="ops-kpi-l">2es visites</div><div class="ops-kpi-v" style="color:#534AB7;">${secondShowings.length}</div></div>
      <div class="ops-act-kpi"><div class="ops-kpi-l">Suivis requis</div><div class="ops-kpi-v" style="color:${followUps.length>0?"#BA7517":"var(--text)"};">${followUps.length}</div></div>
      <div class="ops-act-kpi"><div class="ops-kpi-l">Note moyenne</div><div class="ops-kpi-v">${avgRating("overall")}/5</div></div>
    </div>
    ${acts.length>0?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.25rem;">
      <div class="ops-card"><div class="ops-card-hd"><span class="ops-card-title">Sources de visite</span></div><div style="padding:1rem;">${sourceBar||"<div style='font-size:13px;color:var(--text-3);'>Aucune visite</div>"}</div></div>
      <div class="ops-card"><div class="ops-card-hd"><span class="ops-card-title">Intention d'offre</span></div><div style="padding:1rem;">
        ${["yes","maybe","no"].map(k=>{const n=acts.filter(a=>a.offerIntention===k).length; const pct=acts.length?Math.round(n/acts.length*100):0; return n>0?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><div style="font-size:12px;color:var(--text-2);width:80px;">${intentionLabels[k]}</div><div style="flex:1;background:var(--bg);border-radius:99px;height:8px;overflow:hidden;"><div style="width:${pct}%;height:8px;background:${intentionColors[k]};border-radius:99px;"></div></div><div style="font-size:12px;font-weight:500;width:30px;text-align:right;">${n}</div></div>`:"";}).join("")}
        ${acts.every(a=>!a.offerIntention)?"<div style='font-size:13px;color:var(--text-3);'>Aucune donnée</div>":""}
      </div></div>
    </div>`:``}
    ${followUps.length>0?`<div style="background:#FAEEDA;border:1px solid #FAC775;border-radius:var(--radius-lg);padding:.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:10px;">
      <div style="width:8px;height:8px;border-radius:50%;background:#BA7517;flex-shrink:0;"></div>
      <div style="font-size:13px;font-weight:500;color:#633806;">Suivis requis : ${followUps.map(a=>a.visitorName||a.agentName||"Visiteur").join(", ")}</div>
    </div>`:""}
    <div class="ops-conds-card">
      <div class="ops-conds-hd">
        <span>Journal d'activité (${acts.length})</span>
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="opsOpenActivityForm('${l.id}','visit')">+ Visite</button>
          <button class="btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="opsOpenActivityForm('${l.id}','openhouse')">+ Visite libre</button>
        </div>
      </div>
      ${acts.length?actRows:`<div class="ops-empty">Aucune activité enregistrée — cliquez sur "+ Visite" pour commencer</div>`}
    </div>`;
}

// ── Activity CRUD ──────────────────────────────────────────────────────────

window.opsOpenActivityForm = function(lid, type, editId) {
  const existing = editId ? opsGetActivity(lid).find(a=>a.id===editId) : null;
  const g = f => existing?.[f]||"";
  const gr = f => existing?.ratings?.[f]||"";
  const isOH = (type||existing?.type) === "openhouse";
  const today = new Date().toISOString().slice(0,10);

  const starSelect = (name, id, val) => `
    <div class="form-group"><label>${name}</label>
    <div style="display:flex;gap:6px;">
      ${[1,2,3,4,5].map(n=>`<button type="button" onclick="opsSetRating('${id}',${n})" id="star-${id}-${n}" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:${Number(val||0)>=n?"#0C2B5E":"var(--surface)"};color:${Number(val||0)>=n?"#fff":"var(--text-2)"};font-size:14px;cursor:pointer;">${n}</button>`).join("")}
      <input type="hidden" id="${id}" value="${val||""}">
    </div></div>`;

  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header">
      <div><div class="modal-title">${editId?"Modifier":"Ajouter"} — ${isOH?"Visite libre":"Visite"}</div></div>
      <button class="close-x" onclick="closeAllModals()">×</button>
    </div>
    <div class="mbody-ops" style="max-height:65vh;overflow-y:auto;padding-right:4px;">
      <div class="ops-offer-section-title">Identification</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-group"><label>Date</label><input type="date" id="act-date" value="${g("date")||today}"></div>
        <div class="form-group"><label>Heure</label><input type="time" id="act-time" value="${g("time")||""}"></div>
      </div>
      <div class="form-group"><label>Source</label>
        <select id="act-source">
          <option value="direct"${g("source")==="direct"?" selected":""}>Client direct</option>
          <option value="agent"${g("source")==="agent"?" selected":""}>Courtier</option>
          <option value="immocontact"${g("source")==="immocontact"?" selected":""}>Immocontact</option>
          <option value="realtorca"${g("source")==="realtorca"?" selected":""}>Realtor.ca</option>
          <option value="openhouse"${g("source")==="openhouse"?" selected":""}>Visite libre</option>
          <option value="other"${g("source")==="other"?" selected":""}>Autre</option>
        </select>
      </div>
      ${isOH?`
        <div class="ops-offer-section-title" style="margin-top:1rem;">Résultats de la visite libre</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="form-group"><label>Visiteurs totaux</label><input type="number" id="act-total" min="0" value="${g("totalVisitors")}"></div>
          <div class="form-group"><label>Intéressés</label><input type="number" id="act-interested" min="0" value="${g("interestedCount")}"></div>
          <div class="form-group"><label>Cartes collectées</label><input type="number" id="act-cards" min="0" value="${g("cardsCollected")}"></div>
        </div>
      `:`
        <div class="form-group"><label>Nom du visiteur</label><input type="text" id="act-visitor" value="${g("visitorName")}" placeholder="ex: Jean Tremblay"></div>
        <div class="form-group"><label>Courtier représentant</label><input type="text" id="act-agent" value="${g("agentName")}" placeholder="ex: Marie Dupont — Remax"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label>Téléphone</label><input type="text" id="act-phone" value="${g("phone")}"></div>
          <div class="form-group"><label>Courriel</label><input type="text" id="act-email" value="${g("email")}"></div>
        </div>
        <div class="form-group"><label>Connecté?</label>
          <select id="act-connected">
            <option value="">—</option>
            <option value="yes"${g("connected")==="yes"?" selected":""}>Oui</option>
            <option value="maybe"${g("connected")==="maybe"?" selected":""}>Peut-être</option>
            <option value="no"${g("connected")==="no"?" selected":""}>Non</option>
          </select>
        </div>

        <div class="ops-offer-section-title" style="margin-top:1rem;">Évaluation</div>
        ${starSelect("Note globale","rat-overall",gr("overall"))}
        ${starSelect("Intérieur","rat-interior",gr("interior"))}
        ${starSelect("Extérieur","rat-exterior",gr("exterior"))}
        ${starSelect("Prix","rat-price",gr("price"))}

        <div class="ops-offer-section-title" style="margin-top:1rem;">Suivi</div>
        <div class="form-group"><label>Intention d'offre</label>
          <select id="act-intention">
            <option value="">—</option>
            <option value="yes"${g("offerIntention")==="yes"?" selected":""}>Oui</option>
            <option value="maybe"${g("offerIntention")==="maybe"?" selected":""}>Peut-être</option>
            <option value="no"${g("offerIntention")==="no"?" selected":""}>Non</option>
          </select>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" id="act-second" ${g("secondShowing")==="true"||existing?.secondShowing?"checked":""}> 2e visite</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" id="act-followup" ${g("followUpRequired")==="true"||existing?.followUpRequired?"checked":""}> Suivi requis</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;"><input type="checkbox" id="act-followupdone" ${existing?.followUpDone?"checked":""}> Suivi complété</label>
        </div>
      `}
      <div class="form-group"><label>Notes / Feedback</label>
        <textarea id="act-notes" rows="3" style="width:100%;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--border);font-family:var(--font);resize:vertical;">${g("notes")}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeAllModals()">Annuler</button>
      <button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="opsSaveActivity('${lid}','${type||existing?.type||"visit"}','${editId||""}')">Enregistrer</button>
    </div>`;
  openModal("opsModal");
};

window.opsSetRating = function(id, val) {
  document.getElementById(id).value = val;
  for (let i=1;i<=5;i++) {
    const btn = document.getElementById(`star-${id}-${i}`);
    if (btn) {
      btn.style.background = i<=val?"#0C2B5E":"var(--surface)";
      btn.style.color = i<=val?"#fff":"var(--text-2)";
    }
  }
};

window.opsSaveActivity = async function(lid, type, editId) {
  const g = id => document.getElementById(id)?.value?.trim()||"";
  const gb = id => document.getElementById(id)?.checked||false;
  const isOH = type==="openhouse";

  const data = {
    type, date: g("act-date"), time: g("act-time"),
    source: g("act-source"), notes: g("act-notes"),
    updatedAt: serverTimestamp()
  };

  if (isOH) {
    data.totalVisitors = parseInt(g("act-total"))||0;
    data.interestedCount = parseInt(g("act-interested"))||0;
    data.cardsCollected = parseInt(g("act-cards"))||0;
  } else {
    data.visitorName = g("act-visitor");
    data.agentName = g("act-agent");
    data.phone = g("act-phone");
    data.email = g("act-email");
    data.connected = g("act-connected");
    data.offerIntention = g("act-intention");
    data.secondShowing = gb("act-second");
    data.followUpRequired = gb("act-followup");
    data.followUpDone = gb("act-followupdone");
    data.ratings = {
      overall: g("rat-overall"), interior: g("rat-interior"),
      exterior: g("rat-exterior"), price: g("rat-price")
    };
  }

  const col = collection(db, "ops_listings", lid, "activity");
  if (editId) {
    await updateDoc(doc(db, "ops_listings", lid, "activity", editId), data);
  } else {
    data.createdAt = serverTimestamp();
    data.createdBy = currentUser.uid;
    await addDoc(col, data);
  }
  closeAllModals();
  showToast("Activité enregistrée ✓");
};

window.opsEditActivity = function(lid, aid) {
  const a = opsGetActivity(lid).find(x=>x.id===aid);
  if (a) opsOpenActivityForm(lid, a.type, aid);
};

window.opsDeleteActivity = async function(lid, aid) {
  if (!confirm("Supprimer cette entrée?")) return;
  await deleteDoc(doc(db, "ops_listings", lid, "activity", aid));
  showToast("Activité supprimée");
};

window.opsMarkFollowUpDone = async function(lid, aid) {
  await updateDoc(doc(db, "ops_listings", lid, "activity", aid), {followUpDone:true, updatedAt:serverTimestamp()});
  showToast("Suivi marqué comme complété ✓");
};

window.opsShowNote = function(aid, note) {
  document.getElementById("opsModalContent").innerHTML = `
    <div class="modal-header"><div class="modal-title">Notes</div><button class="close-x" onclick="closeAllModals()">×</button></div>
    <div style="padding:1rem;font-size:13px;color:var(--text-2);line-height:1.7;white-space:pre-wrap;">${note}</div>
    <div class="modal-actions"><button class="btn-primary" style="width:auto;padding:9px 20px;" onclick="closeAllModals()">Fermer</button></div>`;
  openModal("opsModal");
};
