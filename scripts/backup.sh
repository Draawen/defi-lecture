#!/usr/bin/env bash
# Sauvegarde horaire des donnees Upstash Redis (Defi Lecture) via l'API REST
# en lecture seule. Ecriture atomique, refuse d'ecraser une bonne sauvegarde
# par une reponse invalide ou une erreur.
#
# Usage : backup.sh [fichier_env] [dossier_destination]
set -euo pipefail

ENV_FILE="${1:-/opt/defi-lecture-backup/.env}"
DATA_DIR="${2:-/opt/defi-lecture-backup/data}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erreur : fichier d'environnement introuvable ($ENV_FILE)." >&2
  exit 1
fi

# Extrait une variable KEY=valeur ou KEY="valeur" sans sourcer le fichier.
lire_variable() {
  local cle="$1"
  # "|| true" : grep renvoie 1 si la variable est absente (aucune ligne
  # trouvee) ; avec pipefail, ca ferait sortir le script ici au lieu de
  # laisser le controle -z plus bas afficher un message clair.
  grep -m1 "^${cle}=" "$ENV_FILE" | sed -E "s/^${cle}=//; s/\r$//; s/^\"//; s/\"\$//" || true
}

KV_REST_API_URL="$(lire_variable KV_REST_API_URL)"
KV_REST_API_READ_ONLY_TOKEN="$(lire_variable KV_REST_API_READ_ONLY_TOKEN)"
KV_REST_API_URL="${KV_REST_API_URL%/}"

if [[ -z "$KV_REST_API_URL" || -z "$KV_REST_API_READ_ONLY_TOKEN" ]]; then
  echo "Erreur : KV_REST_API_URL ou KV_REST_API_READ_ONLY_TOKEN manquant dans $ENV_FILE." >&2
  exit 1
fi

HOURLY_DIR="$DATA_DIR/hourly"
DAILY_DIR="$DATA_DIR/daily"
mkdir -p "$HOURLY_DIR" "$DAILY_DIR"

HORODATAGE_HEURE="$(date -u +%Y-%m-%dT%H)"
HORODATAGE_JOUR="$(date -u +%Y-%m-%d)"
FICHIER_HEURE="$HOURLY_DIR/${HORODATAGE_HEURE}.json"
FICHIER_JOUR="$DAILY_DIR/${HORODATAGE_JOUR}.json"
FICHIER_TMP="$(mktemp "$HOURLY_DIR/.tmp.XXXXXX")"

nettoyer_tmp() {
  rm -f "$FICHIER_TMP"
}
trap nettoyer_tmp EXIT

# Un seul appel pipeline en lecture seule pour les 3 hachages.
CODE_HTTP="$(curl -s -o "$FICHIER_TMP" -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer ${KV_REST_API_READ_ONLY_TOKEN}" \
  -d '[["HGETALL","lecture:readers"],["HGETALL","lecture:names"],["HGETALL","lecture:entries"]]' \
  "${KV_REST_API_URL}/pipeline")" || {
  echo "Erreur : l'appel a l'API Upstash a echoue (reseau/curl), sauvegarde annulee." >&2
  exit 1
}

if [[ "$CODE_HTTP" != "200" ]]; then
  echo "Erreur : reponse HTTP ${CODE_HTTP} de l'API Upstash, sauvegarde annulee." >&2
  exit 1
fi

CORPS="$(cat "$FICHIER_TMP")"

# Validation structurelle minimale (pas de jq/python3 requis) : un tableau
# de 3 elements {"result":...} et aucun {"error":...}.
CORPS_SANS_ESPACES="$(printf '%s' "$CORPS" | tr -d '[:space:]')"
if [[ "${CORPS_SANS_ESPACES:0:1}" != "[" || "${CORPS_SANS_ESPACES: -1}" != "]" ]]; then
  echo "Erreur : reponse Upstash mal formee (pas un tableau JSON), sauvegarde annulee." >&2
  exit 1
fi

# "|| true" : grep renvoie 1 s'il ne trouve aucune occurrence (ex. 0 erreur,
# le cas normal) ; avec pipefail cela ferait sortir le script a tort ici.
NB_ELEMENTS="$(printf '%s' "$CORPS" | grep -o '{"result"\|{"error"' | wc -l || true)"
NB_ERREURS="$(printf '%s' "$CORPS" | grep -o '{"error"' | wc -l || true)"

if [[ "$NB_ELEMENTS" -ne 3 ]]; then
  echo "Erreur : reponse Upstash ne contient pas 3 elements (${NB_ELEMENTS} trouves), sauvegarde annulee." >&2
  exit 1
fi

if [[ "$NB_ERREURS" -ne 0 ]]; then
  echo "Erreur : la reponse Upstash contient une erreur, sauvegarde annulee." >&2
  exit 1
fi

# Ecriture atomique : le fichier temporaire est deja pret, on le renomme.
mv -f "$FICHIER_TMP" "$FICHIER_HEURE"
trap - EXIT

echo "Sauvegarde horaire ecrite : $FICHIER_HEURE"

# Copie journaliere, une seule fois par jour.
if [[ ! -f "$FICHIER_JOUR" ]]; then
  cp "$FICHIER_HEURE" "$FICHIER_JOUR"
  echo "Sauvegarde journaliere ecrite : $FICHIER_JOUR"
fi

# Retention : horaire 2 jours, journalier 30 jours.
find "$HOURLY_DIR" -maxdepth 1 -type f -name '*.json' -mtime +2 -delete
find "$DAILY_DIR" -maxdepth 1 -type f -name '*.json' -mtime +30 -delete

exit 0
