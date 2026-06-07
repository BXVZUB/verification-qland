# 🛡️ Bot Discord — Vérification OAuth2

---

## ⚙️ Variables d'environnement (Railway)

Sur Railway → ton projet → **Variables**, ajoute ces valeurs :

| Variable | Où trouver |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → Bot → Token |
| `CLIENT_ID` | Developer Portal → General Information → Application ID |
| `CLIENT_SECRET` | Developer Portal → OAuth2 → Client Secret |
| `GUILD_ID` | Clic droit sur ton serveur Discord → Copier l'identifiant |
| `VERIFY_CHANNEL_ID` | Clic droit sur #vérification → Copier l'identifiant |
| `VERIFIED_ROLE_NAME` | Nom du rôle donné après vérif (défaut: `Membre`) |
| `BASE_URL` | L'URL Railway de ton projet ex: `https://discord-bot-xxxx.up.railway.app` |

> ⚠️ Ajoute aussi `BASE_URL/callback` dans **Discord Developer Portal → OAuth2 → Redirects**

---

## 🚀 Déploiement Railway

1. New Project → Deploy from GitHub (upload le dossier)
2. Ajoute toutes les variables ci-dessus dans l'onglet **Variables**
3. Railway lance `npm start` automatiquement

---

## 💻 Déployer les commandes slash (une seule fois, en local)

```bash
npm install
npm run setup
```

> Pour `npm run setup` en local, crée un fichier `.env` temporaire avec les mêmes variables.

---

## 💬 Commandes (Admin uniquement)

| Commande | Description |
|---|---|
| `/setup` | Envoie le message avec bouton dans #vérification |
| `/readd` | Re-ajoute tous les membres vérifiés |
| `/tokens` | Nombre de membres vérifiés |
| `/link` | Affiche le lien OAuth2 |

---

## 🔄 Flux

```
Membre rejoint → voit #vérification → clique "Se vérifier"
      ↓
Page Railway → autorise Discord OAuth2
      ↓
Token stocké → Rôle "Membre" donné automatiquement
      ↓
Accès au serveur ✅
```
