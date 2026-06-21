# نشر حزم Somni على npm (يدوياً)

> الحالة الآن: **لم يُنشر أي شيء على npm بعد.** الكود كله على GitHub فقط.
> الأسماء `@somni/*` غير محجوزة. الخطوات التالية تنشرها بنفسك.

## قبل ما تبدأ

كل الحزم القابلة للنشر مضبوطة بالفعل:
- ✅ `workspace:*` تحوّلت لـ `^1.0.0` (عشان `npm publish` يفهمها).
- ✅ `publishConfig.access = "public"` (مش محتاج `--access public` يدوي).
- ✅ `files: ["dist"]` (يُنشر الـ build فقط، مش الـ source ولا الـ tests).
- ✅ `repository` + `license` لصفحة npm نظيفة.

## 1) احجز الـ scope

ادخل [npmjs.com](https://www.npmjs.com) → **Add Organization** → اسمها `somni` (مجاني للحزم العامة).

> بديل: لو عايز scope باسمك، غيّر `@somni` لـ `@your-name` في كل `package.json` بأمر واحد:
> ```bash
> grep -rl '@somni/' packages --include=package.json | xargs sed -i 's/@somni\//@your-name\//g'
> ```

## 2) سجّل الدخول

```bash
npm login
# username / password / email + OTP
npm whoami   # تأكيد
```

## 3) ابنِ كل الحزم

```bash
pnpm install
pnpm -r build      # ينتج dist/ في كل حزمة
npm test           # 215 اختبار لازم يعدّوا قبل النشر
```

## 4) انشر بالترتيب الصحيح

> **مهم:** الترتيب مهم لأن الحزم تعتمد على بعضها. ابدأ بـ `chat-core` (مفيش حاجة تعتمد عليها قبله موجود على npm).

```bash
# 1) القاعدة أولاً
npm publish -w @somni/chat-core

# 2) الحزم اللي تعتمد على core
npm publish -w @somni/chat-call
npm publish -w @somni/chat-react
npm publish -w @somni/adapter-supabase
npm publish -w @somni/adapter-appwrite
npm publish -w @somni/adapter-firebase

# 3) المستقلة (مفيش deps داخلية)
npm publish -w @somni/notifications
npm publish -w @somni/analytics

# 4) اللي تعتمد على react/call
npm publish -w @somni/chat-ui

# 5) الحزمة الموحّدة آخر حاجة (تعتمد على الكل)
npm publish -w @somni/chat
```

## 5) أكّد النشر

```bash
npm view @somni/chat-core
# أو افتح: https://www.npmjs.com/package/@somni/chat-core
```

## 6) الإصدارات القادمة

```bash
# غيّر الإصدار في كل الحزم دفعة واحدة
pnpm -r exec npm version patch     # 1.0.0 -> 1.0.1
pnpm -r build
# أعد خطوة 4
```

## بديل أسرع: `pnpm publish`

`pnpm` يعيد كتابة `workspace:*` تلقائياً عند النشر، فلو رجعت تستخدمه:
```bash
pnpm -r publish --access public --no-git-checks
```
(لكن إحنا بالفعل حوّلنا لـ `^1.0.0` فالطريقتين يشتغلوا.)

---

## ملاحظات مهمة قبل النشر

1. **iOS Push** يتطلب حساب Apple Developer ($99/سنة) — باقي الخدمات مجانية.
2. **الـ peerDependencies اختيارية**: `livekit-client`, `livekit-server-sdk`, `@daily-co/daily-js`, `@supabase/supabase-js` — المستخدم يثبّت اللي يحتاجه فقط.
3. **ما تنشرش الـ examples** — مش ضمن الحزم (مفيش `files` فيها أو علّمها `private: true`).
