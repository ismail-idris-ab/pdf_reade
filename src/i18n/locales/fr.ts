// Draft French. Hidden until reviewed: see docs/TRANSLATIONS_TO_REVIEW.md.
import type { Catalog } from './en';

export const fr: Catalog = {
  common: {
    cancel: 'Annuler',
    close: 'Fermer',
    errorToast: '{{title}}. {{message}}',
  },
  errors: {
    PASSWORD_REQUIRED: {
      title: 'Ce fichier est protégé par un mot de passe',
      message: 'Saisissez le mot de passe pour l’ouvrir.',
    },
    WRONG_PASSWORD: {
      title: 'Mot de passe incorrect',
      message: 'Ce mot de passe ne fonctionne pas. Vérifiez-le et réessayez.',
    },
    CORRUPT_FILE: {
      title: 'Ce fichier est endommagé',
      message:
        'Il n’a peut-être pas été téléchargé entièrement. Essayez de récupérer le fichier à nouveau.',
    },
    UNSUPPORTED: {
      title: 'Ce type de fichier n’est pas pris en charge',
      message: 'Essayez plutôt d’ouvrir un PDF, une image ou un document Office.',
    },
    NO_SPACE: {
      title: 'Le stockage de votre téléphone est plein',
      message: 'Libérez de l’espace, puis réessayez.',
    },
    OUT_OF_MEMORY: {
      title: 'Ce fichier est trop volumineux pour le moment',
      message: 'Fermez d’autres applications et réessayez.',
    },
    CANCELLED: {
      title: 'Annulé',
      message: 'Rien n’a été modifié.',
    },
    PERMISSION_DENIED: {
      title: 'Autorisation nécessaire',
      message:
        'Autorisez l’accès dans les Paramètres pour que l’application puisse ouvrir vos documents.',
    },
    NOT_FOUND: {
      title: 'Fichier introuvable',
      message: 'Il a peut-être été déplacé ou supprimé.',
    },
    UNKNOWN: {
      title: 'Une erreur est survenue',
      message: 'Veuillez réessayer.',
    },
  },
  recovery: {
    retry: 'Réessayer',
    enterPassword: 'Saisir le mot de passe',
    freeSpace: 'Libérer de l’espace',
    openSettings: 'Ouvrir les Paramètres',
    pickAnotherFile: 'Choisir un autre fichier',
  },
  units: {
    byte: 'o',
    kilobyte: 'Ko',
    megabyte: 'Mo',
    gigabyte: 'Go',
  },
  language: {
    title: 'Langue',
    system: 'Utiliser la langue du téléphone',
  },
  onboarding: {
    title: 'Vos documents, prêts quand vous l’êtes',
    valueTools: 'Lisez, numérisez et compressez vos PDF dans une seule application',
    valuePrivate: 'Fonctionne hors ligne. Vos fichiers restent sur votre téléphone',
    valueNoAds: 'Aucune publicité pendant la lecture',
    allowAccess: 'Autoriser l’accès pour trouver tous les documents',
    allowAccessHint: 'Ouvre les Paramètres. Vous pouvez modifier ce choix à tout moment.',
    pickFiles: 'Choisir des fichiers manuellement',
    manualNote: 'Tout fonctionne sans cet accès. Vous pouvez choisir vos fichiers vous-même.',
  },
  access: {
    bannerMessage:
      'Autorisez l’accès pour que l’application trouve automatiquement tous vos documents.',
    allow: 'Autoriser l’accès',
  },
  library: {
    untitled: 'Document sans titre',
    evictedOldPicks:
      'Pour faire de la place, d’anciens fichiers choisis ont été retirés de la bibliothèque ({{count}}). Choisissez-les à nouveau pour les récupérer.',
    cannotKeepAccess:
      'Certains fichiers n’ont pas pu être ajoutés : leur application d’origine n’autorise pas un accès durable. Essayez d’abord de les enregistrer sur votre téléphone.',
    searchPlaceholder: 'Rechercher par nom',
    clearSearch: 'Effacer la recherche',
    showGrid: 'Afficher en grille',
    showList: 'Afficher en liste',
    sort: 'Trier',
    sortBy: 'Trier par',
    order: 'Ordre',
    devTools: 'Outils de développement',
    tabsLabel: 'Types de fichiers',
    chipsLabel: 'Sources',
    tabs: {
      all: 'Tous',
      pdf: 'PDF',
      word: 'Word',
      excel: 'Excel',
      other: 'Autres',
    },
    chips: {
      all: 'Tous',
      downloads: 'Téléchargements',
      whatsapp: 'WhatsApp',
      scans: 'Numérisations',
      myfiles: 'Mes fichiers',
    },
    sortField: {
      name: 'Nom',
      date: 'Date de modification',
      size: 'Taille',
    },
    sortDir: {
      name: { asc: 'De A à Z', desc: 'De Z à A' },
      date: { asc: 'Plus anciens d’abord', desc: 'Plus récents d’abord' },
      size: { asc: 'Plus petits d’abord', desc: 'Plus grands d’abord' },
    },
    recent: 'Récents',
    favorites: 'Favoris',
    fileDetails: '{{size}} · {{date}}',
    locked: 'Protégé par mot de passe',
    empty: {
      noFilesTitle: 'Aucun document pour l’instant',
      noFilesMessage: 'Choisissez des fichiers sur votre téléphone pour les ajouter ici.',
      pickFiles: 'Choisir des fichiers',
      noFilesHereTitle: 'Aucun fichier ici pour l’instant',
      noFilesHereMessage: 'Essayez un autre type de fichier ou une autre source.',
      noMatchesTitle: 'Aucun fichier correspondant',
      noMatchesMessage: 'Essayez un autre nom, ou vérifiez le type de fichier et la source.',
    },
  },
};
