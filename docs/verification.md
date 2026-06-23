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
chat-core          →  # pass 91   # fail 0
chat-call          →  # pass 44   # fail 0
notifications      →  # pass 44   # fail 0
analytics          →  # pass 48   # fail 0
adapter-supabase   →  # pass 25   # fail 0
الإجمالي          →  252 اختبار ناجح
```

---

## 2) تشغيل كل حزمة على حدة

```bash
# المحرك الأساسي (dedup, offline queue, plugins, reconnect, stress…)
npm --workspace @somni/chat-core test

# المكالمات الصوتية والفيديو (signaling, WebRTC, call state machine, e2e call)
npm --workspace @somni/chat-call test

# الإشعارات (FCM, APNs, Web Push, batching, rate limiting)
npm --workspace @somni/notifications test

# التحليلات (DAU, delivery rates, response times, snapshots)
npm --workspace @somni/analytics test

# Supabase adapter (الاستعلامات، الـ realtime، الـ auth، الـ typing)
npm --workspace @somni/adapter-supabase test
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

مثلاً اختبار التجميع الذكي للإشعارات:

```bash
cd packages/chat-notifications
node --experimental-strip-types --experimental-loader ./tests/loader.mjs \
  --test tests/integration.test.ts
```

---

## 4) ماذا تغطّي الاختبارات (252 اختبار)؟

### الشات (`chat-core` — 91)
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
| `typing` | multi-conversation typing (الـ bug الأصلي + التحقق من الإصلاح)، stopTyping، getTypingUsers، self-filter، destroy |
| `chatEngine` | connection lifecycle، conversation CRUD، message pagination، markAsRead، reactions، multi-subscriber fanout، subscribeConversations، presence، retryDeadLetter، plugin hooks، on() API |

### المكالمات (`chat-call` — 44)
| الملف | يتأكد من |
|------|----------|
| `signaling` | توجيه الرسائل (موجّه/بث) + transport |
| `callEmitter` | البث وعزل الأخطاء |
| `callEngineState` | كل انتقالات الحالة: ringing/incoming/connecting/connected/ended، رفض، إنهاء، timeout، كتم/كاميرا |
| `webrtcProvider` | offer/answer/ICE، تجنّب التضارب (glare)، إغلاق الاتصالات |
| `livekitProvider` | الاتصال بـ LiveKit، tracks، peers، mic/camera/screenshare، token minting |
| `integration` | **مكالمة فيديو كاملة بين طرفين تتصل فعلاً** عبر WebRTC + signaling |

### Supabase Adapter (`adapter-supabase` — 25)
| الملف | يتأكد من |
|------|----------|
| `supabaseAdapter` | الاستعلامات الصحيحة (insert/update/select)، الـ pagination، الـ soft-delete، الـ realtime (message/presence/typing)، إصلاح تسريب الـ typing channel، الـ auth gating |
| `supabaseAuth` | قراءة الـ userId من الجلسة، الـ access token، onAuthStateChange، sign-in/out |

### الإشعارات (`chat-notifications` — 44)
| الملف | يتأكد من |
|------|----------|
| `batchQueue` | التجميع في نافذة زمنية، الحد الأقصى للحزمة، دمج المحادثة، طوارق المستخدمين المنفصلة، destroy |
| `rateLimiter` | حد per-minute/per-hour/per-day، منفصل لكل مستخدم، reset/clear |
| `notificationEngine` | التوجيه للـ provider الصحيح، أحداث queued/sent/failed/rate-limit/token:invalid، الـ destroy |
| `fcmProvider` | send/sendBatch، معالجة الأخطاء، validateToken |
| `webPushProvider` | 201/410/404/400، invalid JSON، custom parseSubscription، sendBatch |
| `integration` | **full flow: queue → batch → provider → events**، collapse 10 رسائل → 1، multi-channel |

### التحليلات (`chat-analytics` — 48)
| الملف | يتأكد من |
|------|----------|
| `timeSeriesBuffer` | query في النافذة، استبعاد القديم، sum/count، prune، eviction عند الامتلاء |
| `metricAggregator` | DAU فريد، delivery rate، response time p50/p95/p99، conversation stats، error count |
| `analyticsEngine` | track → أحداث، provider forwarding، عزل خطأ provider، DAU/rates/errors، destroy |
| `dau` | فريد per-day، message:sent يُحسب، تواريخ منفصلة، getCounters |
| `deliveryRates` | 100%/0%، window filtering، windowStart/End |
| `responseTime` | single sample، p99 < max، unmatched delivery، 5 مستقلة |
| `integration` | **1000 رسالة → 50 مستخدم فريد**، multi-conversation، InMemoryProvider query |

---

## 5) كيف تختبره يدوياً في تطبيق حقيقي؟

1. شغّل المثال:
   ```bash
   cd examples/nextjs-appwrite && npm run dev
   ```
2. افتح المتصفح على نافذتين (أو جهازين) بمستخدمَين مختلفَين.
3. **الشات**: اكتب رسالة من نافذة → تظهر فوراً (optimistic) ثم تتأكد، وتصل للنافذة الثانية لحظياً، وتظهر "يكتب الآن…".
4. **المكالمة**: اضغط زر الاتصال → النافذة الثانية يظهر لها "مكالمة واردة" → اقبلها → يبدأ الصوت/الفيديو.
5. **الإشعارات**: أرسل رسائل متعددة في نفس المحادثة → لاحظ أنها تصل كإشعار واحد مجمّع.
6. اقطع الإنترنت عن نافذة، أرسل رسالة → تبقى "pending"، ثم أعد الإنترنت → تُرسل تلقائياً بالترتيب.

---

## 6) فحص الأنواع والبناء (يحتاج إنترنت لتثبيت الأدوات)

```bash
pnpm install
pnpm -r build          # بناء كل الحزم
pnpm -r typecheck      # فحص TypeScript صارم
```
