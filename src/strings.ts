const TABLE: Record<string, Record<"message" | "offer" | "review" | "error" | "done" | "aiNotice" | "aiAllow" | "aiDecline" | "aiLabel" | "aiOn" | "aiOff" | "change", string>> = {
  en: { message: "Message", offer: "View offer", review: "Leave a review", error: "Couldn't connect. Retrying…", done: "Done", aiNotice: "Our AI assistant can reply right away. To do that, your messages in this chat are sent to Anthropic, our AI provider.", aiAllow: "Allow AI replies", aiDecline: "Humans only", aiLabel: "AI assistant", aiOn: "AI replies on", aiOff: "Humans only", change: "Change" },
  es: { message: "Mensaje", offer: "Ver oferta", review: "Dejar una reseña", error: "Sin conexión. Reintentando…", done: "Listo", aiNotice: "Nuestro asistente de IA puede responder al instante. Para ello, tus mensajes en este chat se envían a Anthropic, nuestro proveedor de IA.", aiAllow: "Permitir respuestas de IA", aiDecline: "Solo personas", aiLabel: "Asistente de IA", aiOn: "Respuestas de IA activadas", aiOff: "Solo personas", change: "Cambiar" },
  de: { message: "Nachricht", offer: "Angebot ansehen", review: "Bewertung schreiben", error: "Keine Verbindung. Neuer Versuch…", done: "Fertig", aiNotice: "Unser KI-Assistent kann sofort antworten. Dafür werden deine Nachrichten in diesem Chat an Anthropic, unseren KI-Anbieter, gesendet.", aiAllow: "KI-Antworten erlauben", aiDecline: "Nur Menschen", aiLabel: "KI-Assistent", aiOn: "KI-Antworten an", aiOff: "Nur Menschen", change: "Ändern" },
  fr: { message: "Message", offer: "Voir l'offre", review: "Laisser un avis", error: "Connexion impossible. Nouvel essai…", done: "OK", aiNotice: "Notre assistant IA peut répondre tout de suite. Pour cela, vos messages dans ce chat sont envoyés à Anthropic, notre fournisseur d'IA.", aiAllow: "Autoriser les réponses IA", aiDecline: "Humains uniquement", aiLabel: "Assistant IA", aiOn: "Réponses IA activées", aiOff: "Humains uniquement", change: "Modifier" },
  it: { message: "Messaggio", offer: "Vedi offerta", review: "Lascia una recensione", error: "Connessione assente. Riprovo…", done: "Fine", aiNotice: "Il nostro assistente IA può rispondere subito. Per farlo, i tuoi messaggi in questa chat vengono inviati ad Anthropic, il nostro fornitore di IA.", aiAllow: "Consenti risposte IA", aiDecline: "Solo persone", aiLabel: "Assistente IA", aiOn: "Risposte IA attive", aiOff: "Solo persone", change: "Modifica" },
  pt: { message: "Mensagem", offer: "Ver oferta", review: "Deixar avaliação", error: "Sem conexão. Tentando de novo…", done: "OK", aiNotice: "Nosso assistente de IA pode responder na hora. Para isso, suas mensagens neste chat são enviadas à Anthropic, nossa provedora de IA.", aiAllow: "Permitir respostas de IA", aiDecline: "Só pessoas", aiLabel: "Assistente de IA", aiOn: "Respostas de IA ativadas", aiOff: "Só pessoas", change: "Alterar" },
  ja: { message: "メッセージ", offer: "オファーを見る", review: "レビューを書く", error: "接続できません。再試行中…", done: "完了", aiNotice: "AIアシスタントがすぐに返信できます。そのため、このチャットのメッセージはAIプロバイダーのAnthropicに送信されます。", aiAllow: "AIの返信を許可", aiDecline: "人のみ", aiLabel: "AIアシスタント", aiOn: "AIの返信：オン", aiOff: "人のみ", change: "変更" },
  ko: { message: "메시지", offer: "혜택 보기", review: "리뷰 남기기", error: "연결할 수 없습니다. 다시 시도 중…", done: "완료", aiNotice: "AI 어시스턴트가 바로 답변할 수 있습니다. 이를 위해 이 채팅의 메시지가 AI 제공업체인 Anthropic으로 전송됩니다.", aiAllow: "AI 답변 허용", aiDecline: "사람만", aiLabel: "AI 어시스턴트", aiOn: "AI 답변 켜짐", aiOff: "사람만", change: "변경" },
  zh: { message: "消息", offer: "查看优惠", review: "写评价", error: "无法连接，正在重试…", done: "完成", aiNotice: "我们的 AI 助手可以立即回复。为此，你在此聊天中的消息会发送给我们的 AI 服务商 Anthropic。", aiAllow: "允许 AI 回复", aiDecline: "仅人工", aiLabel: "AI 助手", aiOn: "AI 回复已开启", aiOff: "仅人工", change: "更改" },
  tr: { message: "Mesaj", offer: "Teklifi gör", review: "Değerlendir", error: "Bağlanılamadı. Yeniden deneniyor…", done: "Bitti", aiNotice: "Yapay zekâ asistanımız hemen yanıt verebilir. Bunun için bu sohbetteki mesajların yapay zekâ sağlayıcımız Anthropic'e gönderilir.", aiAllow: "Yapay zekâ yanıtlarına izin ver", aiDecline: "Yalnızca insanlar", aiLabel: "Yapay zekâ asistanı", aiOn: "Yapay zekâ yanıtları açık", aiOff: "Yalnızca insanlar", change: "Değiştir" },
};

export function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

/** The SDK's own UI labels in the device language. Your welcome message is shown as written. */
export function t(key: keyof (typeof TABLE)["en"]) {
  const lang = deviceLocale().split("-")[0];
  return (TABLE[lang] ?? TABLE.en)[key];
}
