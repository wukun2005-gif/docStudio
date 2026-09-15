import { useLanguage } from "../i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex items-center gap-0.5 text-xs border rounded-md overflow-hidden">
      <button
        onClick={() => setLocale("zh-CN")}
        className={`px-2 py-1 transition-colors ${
          locale === "zh-CN"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        中文
      </button>
      <button
        onClick={() => setLocale("en")}
        className={`px-2 py-1 transition-colors ${
          locale === "en"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        English
      </button>
    </div>
  );
}
