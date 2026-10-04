// Draft French. Hidden until reviewed: see docs/TRANSLATIONS_TO_REVIEW.md.
import type { Catalog } from './en';

export const fr: Catalog = {
  common: {
    cancel: 'Annuler',
    close: 'Fermer',
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
};
