# كيف تتأكد بنفسك أن كل شيء شغّال ✅

كل الاختبارات تعمل **بدون أي تثبيت** (`npm install` غير مطلوب) — تحتاج فقط **Node.js 22+**.

```bash
node --version    # لازم تكون 22 أو أعلى
```

---

## 1) تشغيل كل الاختبارات دفعة واحدة

من جذر المشروع:

```bash
npm test
```

النتيجة المتوقعة:

```
chat-core  →  # pass 54   # fail 0
chat-call  →  # pass 30   # fail 0
الإجمالي  →  84 اختبار ناجح
```

---

## 2) تشغيل كل حزمة على حدة

```bash
# المحرك الأساسي (dedup, offline queue, plugins, reconnect, stress…)
npm --workspace @somni/chat-core test

# المكالمات الصوتية والفيديو (signaling, WebRTC, call state machine, e2e call)
npm --workspace @somni/chat-call test
```

---

## 3) تشغيل اختبار واحد بالتفصيل

مثلاً اختبار المكالمة الكاملة من طرف لطرف:

```bash
cd packages/chat-call
node --experimental-strip-types --experimental-loader ./tests/loader.mjs \
  --test tests/integration.test.ts
```

المتوقع:
```
ok 1 - end-to-end 1:1 video call connects over WebRTC + signaling
ok 2 - callee rejecting ends the call on both sides
ok 3 - audio-only call requests no video track
```

---

## 4) ماذا تغطّي الاختبارات (84 اختبار)؟

### الشات (`chat-core` — 54)
| الملف | يتأكد من |
|------|----------|
| `deduplication` | عدم تكرار الرسائل + المصالحة + حدود الذاكرة |
| `offlineQueue` / `offlineRecovery` | الطابور FIFO، backoff، dead-letter، النجاة من إعادة التحميل، التعافي بعد الاتصال |
| `validation` | تنقية المدخلات ورفض الفارغ/الطويل |
| `backoff` | النمو الأسي + jitter |
| `eventEmitter` / `subscriptionRegistry` | البث، عدم التسريب، fan-out |
| `pluginManager` | تعديل/حظر الرسائل + حقن AI + عزل الأخطاء |
| `validateAdapter` | رفض أي adapter ناقص |
| `engine.integration` | optimistic بدون تكرار + حظر plugin |
| `stress` | **1000 رسالة فورية → صفر تكرار** |

### المكالمات (`chat-call` — 30)
| الملف | يتأكد من |
|------|----------|
| `signaling` | توجيه الرسائل (موجّه/بث) + transport |
| `callEmitter` | البث وعزل الأخطاء |
| `callEngineState` | كل انتقالات الحالة: ringing/incoming/connecting/connected/ended، رفض، إنهاء، timeout، كتم/كاميرا |
| `webrtcProvider` | offer/answer/ICE، تجنّب التضارب (glare)، إغلاق الاتصالات |
| `integration` | **مكالمة فيديو كاملة بين طرفين تتصل فعلاً** عبر WebRTC + signaling |

---

## 5) كيف تختبره يدوياً في تطبيق حقيقي؟

1. شغّل المثال:
   ```bash
   cd examples/nextjs-appwrite && npm run dev
   ```
2. افتح المتصفح على نافذتين (أو جهازين) بمستخدمَين مختلفَين.
3. **الشات**: اكتب رسالة من نافذة → تظهر فوراً (optimistic) ثم تتأكد، وتصل للنافذة الثانية لحظياً، وتظهر "يكتب الآن…".
4. **المكالمة**: اضغط زر الاتصال → النافذة الثانية يظهر لها "مكالمة واردة" → اقبلها → يبدأ الصوت/الفيديو.
5. اقطع الإنترنت عن نافذة، أرسل رسالة → تبقى "pending"، ثم أعد الإنترنت → تُرسل تلقائياً بالترتيب.

---

## 6) فحص الأنواع والبناء (يحتاج إنترنت لتثبيت الأدوات)

```bash
pnpm install
pnpm -r build          # بناء كل الحزم
pnpm -r typecheck      # فحص TypeScript صارم
```
