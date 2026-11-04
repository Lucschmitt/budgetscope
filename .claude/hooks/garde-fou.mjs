#!/usr/bin/env node
// Garde-fou de l'atelier (hook PreToolUse de Claude Code).
// Lit l'appel d'outil sur stdin ; sortie 2 = appel bloqué, le message sur stderr est renvoyé à Claude.
// Source de vérité : dépôt « atelier », template/.claude/hooks/garde-fou.mjs.
import { readFileSync } from "node:fs";

const entree = JSON.parse(readFileSync(0, "utf8"));
const outil = entree.tool_name ?? "";
const e = entree.tool_input ?? {};

function bloquer(raison) {
  process.stderr.write(`Garde-fou atelier : ${raison}\n`);
  process.exit(2);
}

// Fichiers de secrets : .env et variantes (sauf .env.example), comptes de service, clés privées.
const FICHIER_SECRET =
  /(^|[\\/])(\.env(\.[\w.-]+)?|[^\\/]*serviceAccount[^\\/]*\.json|[^\\/]*-firebase-adminsdk-[^\\/]*\.json|credentials[^\\/]*\.json|[^\\/]*\.(pem|key|p12))$/i;
const estExemple = (chemin) => /(^|[\\/])\.env\.example$/i.test(chemin);

if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(outil)) {
  const chemin = String(e.file_path ?? e.notebook_path ?? "");
  if (FICHIER_SECRET.test(chemin) && !estExemple(chemin)) {
    bloquer(`accès refusé à un fichier de secrets (${chemin}). Travaille avec le .env.example.`);
  }
}

if (outil === "Bash") {
  const c = String(e.command ?? "");

  // Un fichier .env cité comme argument (pas process.env.X, pas .env.example).
  const envCites = [...c.matchAll(/(?:^|[\s/\\"'=<>])(\.env(?:\.[\w.-]+)?)(?=$|[\s"';|&>)])/g)].map((m) => m[1]);
  if (envCites.some((f) => f !== ".env.example")) bloquer("commande qui lit ou modifie un fichier .env");

  const regles = [
    [/git\s+push\b[^\n]*\s(--force(-with-lease)?|-f)(\s|$)/, "git push --force interdit"],
    [/git\s+push\b[^\n]*[\s:](main|master)(\s|$)/, "push direct sur main interdit : ouvre une PR"],
    [/--no-verify\b/, "contournement des hooks git (--no-verify) interdit"],
    [/firebase(-tools)?\s+deploy\b(?![^\n]*(--project[= ]|-P\s+)(\S*-dev|dev)(\s|$))/, "firebase deploy interdit hors DEV (--project dev) : la prod se déploie par la CI après merge"],
    [/gh\s+secret\s+(set|delete)\b/, "modification des secrets GitHub réservée à Luc"],
    [/rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|[A-Za-z]:[\\/]?)(\s|$)/, "suppression récursive d'une racine"],
  ];
  for (const [re, raison] of regles) if (re.test(c)) bloquer(raison);
}

process.exit(0);
