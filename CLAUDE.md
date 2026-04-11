# BudgetScope — Contexte projet Claude

## Dépôt
- GitHub : lucschmitt/budgetscope (public)
- Publication : GitHub Pages
- Local : D:/Travail/IA_test/budgetscope

## Concept
Simulateur interactif des finances publiques françaises.
- Gauche : recettes (curseurs modifiables)
- Droite : dépenses (curseurs modifiables)
- Centre : diagramme Sankey dynamique
- Bas : indicateurs déficit / dette / croissance mis à jour en temps réel
- Cartes de mesures : chaque proposition cochée déclenche une fiche annotée

## Stack technique

### Vitrine (GitHub Pages)
- **Framework** : Astro 4.x (static output → GitHub Pages)
- **UI interactive** : React 18 (îles Astro — uniquement là où c'est nécessaire)
- **Sankey** : D3-sankey (via d3 v7)
- **Style** : Tailwind CSS 3 + CSS variables pour le thème sombre
- **Thème** : sombre par défaut, responsive
- **Données** : fichiers JSON dans /src/data/ (chargés à la build)
- **Fiches mesures** : fichiers .json dans /src/data/mesures/ → pages statiques Astro
- **Publication** : astro build → /dist → GitHub Pages (branche gh-pages)

### Pipeline agents IA (Docker)
- **Orchestration** : Docker Compose
- **Langage** : Node.js 20 (un conteneur par agent)
- **API** : Claude API Sonnet 4.6
- **Stockage intermédiaire** : volume Docker partagé entre agents
- **Déclenchement** : CLI local → coordinator → agents parallèles → JSON fiche-mesure
- **Pas de cloud requis** : tourne en local sur le PC de développement

## Architecture déploiement

```
┌─────────────────────────────────────┐
│  GitHub Pages (statique)            │
│  Astro build → /dist                │
│  Données : JSON pré-générés         │
│  Pas d'API exposée                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Docker Compose (local)             │
│  ┌─────────┐  ┌────────────────┐   │
│  │ agent-  │  │ agent-rag      │   │
│  │ extract │  │ agent-macro    │   │
│  │         │  │ agent-indirect │   │
│  └────┬────┘  └───────┬────────┘   │
│       └───────┬────────┘            │
│          ┌────▼────┐                │
│          │coordinator│              │
│          └────┬────┘                │
│               │ écrit               │
│          /src/data/mesures/*.json   │
└─────────────────────────────────────┘
```

**Workflow** :
1. `docker compose run coordinator --input "url_ou_pdf"`
2. Les agents tournent, produisent un fichier JSON dans `/src/data/mesures/`
3. `npm run build` régénère le site statique avec la nouvelle fiche
4. `npm run deploy` pousse sur gh-pages

## Structure du dépôt
```
budgetscope/
├── src/
│   ├── pages/
│   │   ├── index.astro          ← page principale simulateur
│   │   └── mesures/[id].astro   ← pages fiches mesures
│   ├── components/
│   │   ├── Sankey.tsx           ← diagramme D3 (île React)
│   │   ├── Simulateur.tsx       ← curseurs + état global (île React)
│   │   ├── FicheMesure.tsx      ← carte mesure annotée (île React)
│   │   └── Indicateurs.tsx      ← déficit/dette/croissance (île React)
│   ├── data/
│   │   ├── budget_2025.json     ← agrégats PLF 2025
│   │   ├── multiplicateurs.json ← élasticités OFCE/IPP
│   │   └── mesures/             ← une fiche JSON par mesure (générée par agents)
│   ├── layouts/
│   │   └── Base.astro           ← layout thème sombre
│   └── styles/
│       └── global.css           ← CSS variables thème
├── tools/
│   └── agents/                  ← pipeline IA (Docker)
│       ├── docker-compose.yml   ← orchestration des conteneurs
│       ├── extract/
│       │   ├── Dockerfile
│       │   └── index.js
│       ├── rag/
│       │   ├── Dockerfile
│       │   └── index.js
│       ├── macro/
│       │   ├── Dockerfile
│       │   └── index.js
│       ├── indirect/
│       │   ├── Dockerfile
│       │   └── index.js
│       └── coordinator/
│           ├── Dockerfile
│           └── index.js
├── public/
├── CLAUDE.md                    ← ce fichier
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

## Données — Agrégats recettes (PLF 2025)
- IR : ~94 mds
- IS : ~67 mds
- TVA : ~216 mds
- TICPE + autres taxes : ~35 mds
- Cotisations sociales : ~400 mds
- Autres recettes : ~60 mds

## Données — Agrégats dépenses (PLF 2025)
- Éducation : ~60 mds
- Santé / Sécu : ~260 mds
- Défense : ~47 mds
- Charge de la dette : ~54 mds
- Collectivités : ~45 mds
- Emploi / travail : ~55 mds
- Autres : ~120 mds

## Modèle macro simplifié
- Multiplicateurs différenciés par type de mesure (source OFCE/IPP)
- Fourchette basse / haute affichée (pas de fausse précision)
- Indicateurs calculés : déficit primaire, ratio dette/PIB, impact croissance

## Format fiche-mesure (JSON)
```json
{
  "id": "string",
  "label": "string",
  "source": { "type": "proposition|loi|programme", "auteur": "", "url": "" },
  "impact_direct": { "poste": "", "montant_min_mds": 0, "montant_max_mds": 0, "statut": "" },
  "effets_indirects": [{ "type": "", "label": "", "impact_estime": "", "statut": "" }],
  "analogies_historiques": [{ "pays": "", "annee": 0, "mesure": "", "impact_observe": "", "score_similarite": 0, "source": "" }],
  "questions_soulevees": [],
  "statut_global": "observe|hypothese_partielle|hypothese_non_verifiee|incertain",
  "confiance": "haute|moyenne|faible"
}
```

## Mesures déjà modélisées
- Taxe Zucman : +19–25 mds IR, fuite −0.03%, statut hypothese_partielle
- Suppression AME : −1.1–1.3 mds santé, externalités non chiffrées, statut incertain

## Pipeline agents IA
1. Extraction (sériel) : PDF/URL → mesures atomiques
2A. RAG historique (parallèle) : OCDE, FMI, IPP → analogies + score confiance
2B. Modèle macro (parallèle) : Δrecettes/dépenses → Δdéficit + croissance
2C. Effets indirects (parallèle) : comportements, externalités, questions
3. Coordinateur (sériel) : synthèse → JSON fiche-mesure

## Commandes utiles
```bash
# Développement vitrine
npm run dev          # astro dev → localhost:4321
npm run build        # astro build → /dist
npm run deploy       # push /dist sur gh-pages

# Pipeline agents (Docker)
docker compose -f tools/agents/docker-compose.yml run coordinator --input "url_ou_pdf"
docker compose -f tools/agents/docker-compose.yml build   # rebuild les images
docker compose -f tools/agents/docker-compose.yml logs    # logs de tous les agents
```

## Principes éditoriaux
- Toute mesure a un statut épistémique explicite (observé / hypothèse / incertain)
- Les hypothèses partisanes sont clairement étiquetées
- Les fourchettes d'incertitude sont toujours affichées
- Sources citées obligatoires pour tout chiffre

## Journal de recherche
- `ia4d log -p budgetscope -t "..." -b "..." --tags "..."`
- Fichier : D:/Travail/IA_test/ia4democracy/IA4DEMOCRACY.md

## Prochaines étapes
- [ ] Init Astro + React + Tailwind + D3
- [ ] budget_2025.json avec agrégats PLF 2025
- [ ] Layout thème sombre + CSS variables
- [ ] Composant Sankey.tsx statique
- [ ] Composant Simulateur.tsx avec curseurs
- [ ] Première fiche-mesure (taxe Zucman)
- [ ] docker-compose.yml + Dockerfiles agents
- [ ] Pipeline agents RAG historique
