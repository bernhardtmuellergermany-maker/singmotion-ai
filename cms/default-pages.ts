export const legacyPages: Record<
  string,
  { title: string; intro: string; sections: [string, string][] }
> = {
  help: {
    title: "A good performance starts here.",
    intro: "A few small choices can make a big difference.",
    sections: [
      [
        "Start with your best 5–10 seconds",
        "Upload MP3 or WAV audio (up to 50 MB), choose a clear lead vocal, and use the waveform handles or exact second fields to select your clip. The server converts your selected segment to MP3 and validates its duration and size.",
      ],
      [
        "Give your artist a clear reference",
        "Upload a sharp JPEG or PNG, up to 30 MB and 4096 × 4096 pixels. Prefer an unobstructed face and visible mouth. Save different views to your artist profile; only one image is selected for each generation.",
      ],
      [
        "Keep the first take simple",
        "Static Close-Up and gentle movement are safer starting points. Strong head rotation can alter facial details; moving cameras can affect background stability. Presets are guidance, never guaranteed controls.",
      ],
      [
        "Make the direction your own",
        "Enter an English Custom Performance Prompt for expressions, gestures, or atmosphere. It replaces preset directions in full, so include any camera instructions you want to keep. Preview the exact prompt before generating.",
      ],
      [
        "What the demo actually does",
        "Audio is really trimmed, uploads are checked, and projects persist privately. The result is a fixed labeled sample video with synthetic audio. It does not animate your image or use your song. Charges are simulated.",
      ],
    ],
  },
  privacy: {
    title: "Privacy policy",
    intro: "Draft for legal review — not a finalized privacy policy.",
    sections: [
      [
        "Local demonstration data",
        "The app stores uploaded songs, original reference images, projects, and a private session identifier on the server filesystem. The cookie lasts 30 days. Media requests require the owning session. No uploaded media is sent to paid AI providers in demo mode.",
      ],
      [
        "Retention and deletion",
        "Use Settings to delete your demo data. A local cleanup command removes expired sessions and their data. Proposed production retention: temporary audio about 24 hours after job completion; generated videos 30 days unless a saved-content policy applies; saved artists until deletion. Production retention automation and policy require review.",
      ],
      [
        "Before public launch",
        "The operator must supply controller details, legal bases, processor agreements, international transfer disclosures, contact channels, retention decisions, and data-subject request procedures. No GDPR compliance claim is made.",
      ],
    ],
  },
  terms: {
    title: "Terms of service",
    intro:
      "Draft for legal review — live services and payments are not available.",
    sections: [
      [
        "Your uploaded content",
        "Only upload music and likenesses you own or have permission to use. Do not impersonate people deceptively or create unlawful content. You must confirm permission before submitting a generation.",
      ],
      [
        "AI limitations and pricing",
        "Future AI output may not follow all directions or preserve identity perfectly. Pricing shown in the demo is illustrative. Technical failures restore demo credits; subjective dissatisfaction with completed outputs is not an automatic refund promise.",
      ],
      [
        "Review required",
        "Contract formation, consumer rights, cancellation, acceptable use, payment/refund terms, age requirements, and liability require professional review before activation.",
      ],
    ],
  },
  legal: {
    title: "Legal notice / Impressum",
    intro:
      "Not yet complete — operator information must be supplied before public launch.",
    sections: [
      [
        "Required operator details",
        "Business name, legal form, service address, authorized representative, verified contact details, and applicable registration and VAT information are not yet provided.",
      ],
      [
        "Publication checkpoint",
        "This placeholder is not a compliant final Impressum and must be replaced by reviewed operator information before any public launch.",
      ],
    ],
  },
  rights: {
    title: "Music, likeness & consent",
    intro: "Your creativity starts with permission.",
    sections: [
      [
        "Music rights",
        "Use original music or music for which you hold all required permissions. SingMotion does not download tracks from Spotify or arbitrary third-party URLs.",
      ],
      [
        "Likeness rights",
        "Have the person’s appropriate permission to animate or depict their likeness. Do not imply endorsements or impersonate someone without authorization. Maintain proof of relevant permissions.",
      ],
      [
        "AI disclosure",
        "Future AI-generated outputs may require clear disclosure depending on context and applicable law. This demo is always labeled. Disclosure requirements must be reviewed before launch.",
      ],
    ],
  },
  contact: {
    title: "Contact & support",
    intro:
      "Support and reporting channels must be configured before public launch.",
    sections: [
      [
        "Need help with the studio?",
        "Visit Help for upload requirements, waveform editing, and demo limitations.",
      ],
      [
        "Report abuse or unauthorized likeness use",
        "A verified reporting address and handling process are not yet configured. Before launch, the operator must provide a functioning channel for reports, removal requests, privacy requests, and appeals. Do not use this local preview as a public service.",
      ],
    ],
  },
  signin: {
    title: "Your next performance awaits.",
    intro:
      "Production sign-in is not connected yet. Explore a private local demo without a paid account.",
    sections: [
      [
        "A private demonstration workspace",
        "Start a demo session to upload music, save artists, and test the workflow. Your session is tied to this browser; it is not recoverable through email. Supabase sign-in and recovery will be enabled only after security validation.",
      ],
    ],
  },
  signup: {
    title: "Make something yours.",
    intro: "Account registration will open after secure backend activation.",
    sections: [
      [
        "Try the studio today",
        "The local demo needs no payment credentials. Your files are private to your browser session, and generated output is an explicitly labeled fixed sample.",
      ],
    ],
  },
};
