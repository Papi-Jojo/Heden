/* Configuration de Heden.
   Remplir avec les valeurs de Supabase > Project Settings > API (ou Data API) :
   - supabaseUrl     : « Project URL », du type https://abcdefgh.supabase.co
   - supabaseAnonKey : clé publique « anon » / « publishable ». Elle est faite pour être visible dans le site ;
                       ne jamais mettre ici la clé « service_role » / « secret ».
   Laissé vide, le site fonctionne sans compte, avec les zones enregistrées sur l'appareil. */
window.HEDEN_CONFIG = {
  supabaseUrl: "https://qrorhjypoppeplndpmyj.supabase.co",
  supabaseAnonKey: "sb_publishable_-3v-JqBfx38pvpdInzfaYg_dZE-8Zh5",
  /* passer à true une fois un serveur d'envoi (SMTP) branché et le code {{ .Token }} ajouté au modèle d'e-mail */
  codeParEmail: false
};
