const resolveProviderFromSender = (senderAddress = '') => {
  const clean = senderAddress.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!clean || clean === 'unknown') return null;

  // Reject standard phone numbers (e.g. 017..., +88017..., 88017...)
  if (/^(\+?88)?01[3-9][0-9]{8}$/.test(clean)) {
    return null;
  }

  if (clean.includes('bkash') || clean.includes('16247')) return 'bKash';
  if (clean.includes('nagad') || clean.includes('16167')) return 'Nagad';
  if (clean.includes('rocket') || clean.includes('16216') || clean.includes('dbbl')) return 'Rocket';
  if (clean.includes('upay') || clean.includes('16268')) return 'Upay';

  return null;
};

const parseSms = (smsBody, senderAddress = '') => {
  if (!smsBody) {
    return { provider: 'Unknown', amount: 0, transactionId: '', sender: '', isPayment: false };
  }

  // Strict sender allowlisting: reject numeric senders & unknown addresses
  const provider = resolveProviderFromSender(senderAddress);
  if (!provider) {
    return { provider: 'Unknown', amount: 0, transactionId: '', sender: '', isPayment: false };
  }

  // Bengali numerals normalization
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  let normalizedBody = smsBody;
  bengaliDigits.forEach((digit, i) => {
    normalizedBody = normalizedBody.split(digit).join(i.toString());
  });

  const text = normalizedBody.trim();

  // 1. bKash Parser
  if (provider === 'bKash') {
    const txMatch = text.match(/(?:TrxID|Trx Id|TxnID|TxID|Transaction ID|আইডি)\s*:?\s*([A-Z0-9_\-]{6,35})/i);
    const amountMatch = text.match(/(?:Tk|BDT|Tk\.|BDT\.|৳|Amount:?\s*(?:Tk|BDT|৳)?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
      || text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:Tk|BDT|৳|টাকা)/i);
    const senderMatch = text.match(/(?:from|by|হতে|থেকে)\s+([0-9+]+)/i) || text.match(/sender\s+([0-9+]+)/i);
    const refMatch = text.match(/Ref\s+([^.]+)/i);

    return {
      provider: 'bKash',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'bKash Customer',
      reference: refMatch ? refMatch[1].trim() : '',
      isPayment: !!(txMatch && amountMatch && parseFloat(amountMatch[1].replace(/,/g, '')) > 0)
    };
  }

  // 2. Nagad Parser
  if (provider === 'Nagad') {
    const txMatch = text.match(/(?:TxnID|TxnId|Txn ID|TxID|TrxID|Transaction ID|আইডি)\s*:?\s*([A-Z0-9_\-]{6,35})/i);
    const amountMatch = text.match(/(?:Tk|BDT|Tk\.|BDT\.|৳|Amount:?\s*(?:Tk|BDT|৳)?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
      || text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:Tk|BDT|৳|টাকা)/i);
    const senderMatch = text.match(/(?:From|by|হতে|থেকে)\s*:?\s*([0-9+]+)/i);
    const refMatch = text.match(/Ref:\s*([^.]+)/i);

    return {
      provider: 'Nagad',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Nagad Customer',
      reference: refMatch ? refMatch[1].trim() : '',
      isPayment: !!(txMatch && amountMatch && parseFloat(amountMatch[1].replace(/,/g, '')) > 0)
    };
  }

  // 3. Rocket Parser
  if (provider === 'Rocket') {
    const txMatch = text.match(/(?:TxnId|TxnID|TxID|TrxID|Txn\s*No|Transaction ID|আইডি)\s*:?\s*([A-Z0-9_\-]{6,35})/i);
    const amountMatch = text.match(/(?:Tk|BDT|Tk\.|BDT\.|৳|Amount:?\s*(?:Tk|BDT|৳)?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
      || text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:Tk|BDT|৳|টাকা)/i);
    const senderMatch = text.match(/(?:from|by)\s+([0-9+]+)/i);

    return {
      provider: 'Rocket',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Rocket Customer',
      reference: '',
      isPayment: !!(txMatch && amountMatch && parseFloat(amountMatch[1].replace(/,/g, '')) > 0)
    };
  }

  // 4. Upay Parser
  if (provider === 'Upay') {
    const txMatch = text.match(/(?:TrxID|TxnID|TxID|Transaction ID|আইডি)\s*:?\s*([A-Z0-9_\-]{6,35})/i);
    const amountMatch = text.match(/(?:Amount:?\s*(?:Tk|BDT|৳)?|Tk|BDT|Tk\.|BDT\.|৳)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
      || text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:Tk|BDT|৳|টাকা)/i);
    const senderMatch = text.match(/(?:from|by)\s+([0-9+]+)/i);

    return {
      provider: 'Upay',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Upay Customer',
      reference: '',
      isPayment: !!(txMatch && amountMatch && parseFloat(amountMatch[1].replace(/,/g, '')) > 0)
    };
  }

  return {
    provider: 'Unknown',
    transactionId: '',
    amount: 0,
    sender: 'Unknown',
    reference: '',
    isPayment: false
  };
};

module.exports = { parseSms };
