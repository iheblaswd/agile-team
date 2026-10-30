// Who is talking in Slack: one display name and one icon per agent, so the channel reads like a team chat.
// Slack shows them when the bot has the `chat:write.customize` scope; without it Slack ignores them silently.

const BASE = {
  po: { name: "Product Owner", icon: ":clipboard:" },
  "scrum-master": { name: "Scrum Master", icon: ":calendar:" },
  "tech-lead": { name: "Tech Lead", icon: ":mag:" },
  devops: { name: "DevOps", icon: ":rocket:" },
  "ux-designer": { name: "Designer", icon: ":art:" },
  team: { name: "Équipe", icon: ":busts_in_silhouette:" },
};

export function persona(id) {
  if (BASE[id]) return BASE[id];
  if (id?.startsWith("dev-")) return { name: `Développeur (${id.slice(4)})`, icon: ":hammer_and_wrench:" };
  return { name: id || "Équipe", icon: ":busts_in_silhouette:" };
}

const clean = (s) => String(s || "").replace(/\\n/g, "\n").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/`([^`\n]+)`/g, "$1").trim();
const firstLine = (s) => clean(s).split("\n").map((l) => l.trim()).find(Boolean) || "";
const prUrl = (s) => (String(s || "").match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/) || [])[0];
const firstNumbered = (s) => {
  const m = String(s || "").replace(/\\n/g, "\n").match(/^\s*1[.)]\s*(.+)$/m);
  return m ? clean(m[1]) : firstLine(s);
};

// One short chat line, in French, for an agent-to-agent event. Returns null for events that would
// only be noise for the human (a plain technical note with no recognisable meaning).
export function activityLine({ from, to, ticket, title, body, summary }) {
  const t = String(title || "");
  const who = to && to !== "team" ? persona(to).name : null;
  const what = ticket ? `*${ticket}*${summary ? ` (${summary})` : ""}` : "";
  const pr = prUrl(body) || prUrl(t);

  if (/^started\b/i.test(t)) return `▶️ Je commence ${what}.`;
  if (/^fixing\b/i.test(t)) return `🔧 Je reprends ${what} pour corriger ce que la relecture a demandé.`;
  if (/ready for review/i.test(t)) return `📬 J'ai terminé ${what}. La demande de fusion est prête${pr ? ` : ${pr}` : ""}.${who ? ` ${who}, à toi pour la relecture.` : ""}`;
  if (/\baccepted\b/i.test(t) && /\bMR\b|merge/i.test(t)) return `✅ Relecture validée : ${what} est intégré.${pr ? ` ${pr}` : ""}`;
  if (/\brejected\b/i.test(t) && /\bMR\b|merge/i.test(t)) return `↩️ ${what} repart en correction : ${firstNumbered(body)}`;
  if (/^merged on main/i.test(t)) return `🔀 C'est intégré : ${t.replace(/^merged on main:?\s*/i, "")}.`;
  if (/deployed/i.test(t)) return `🚀 Déployé en préproduction${(String(body).match(/https?:\/\/\S+/) || [])[0] ? ` : ${(String(body).match(/https?:\/\/\S+/) || [])[0]}` : ""}.`;
  if (/^QUESTION:/i.test(t)) return `❓ ${who ? `${who}, ` : ""}une question sur ${what} : ${clean(t.replace(/^QUESTION:\s*/i, ""))}`;
  if (/^ANSWER:/i.test(t)) return `💬 ${who ? `${who}, ` : ""}${clean(t.replace(/^ANSWER:\s*/i, ""))}`;
  if (/backend done/i.test(t)) return `🧩 La partie serveur de ${what} est prête.${who ? ` ${who}, tu peux continuer.` : ""}`;
  if (/adjustment needed/i.test(t)) return `🔁 ${who ? `${who}, ` : ""}j'ai besoin d'un ajustement pour ${what} : ${firstLine(body)}`;
  if (/chores? request|follow-up chore/i.test(t)) return `🧹 J'ai noté quelques améliorations à planifier${what ? ` après ${what}` : ""}.${who ? ` ${who}, je te les confie.` : ""}`;
  if (/^no ticket available/i.test(t)) return `⏸️ Plus de ticket pour moi dans ce sprint, je m'occupe de petites améliorations en attendant.`;
  if (/spec written/i.test(t)) return `📝 Nouvelle histoire prête : ${what}.`;
  if (/correction requested/i.test(t)) return `🛠️ Correction demandée sur ${what}${who ? `, ${who} s'en charge` : ""}.`;
  if (/blocked|blocker/i.test(t)) return `⛔ Je suis bloqué sur ${what} : ${firstLine(body)}`;
  return null;
}
