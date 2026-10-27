// Names students type in lower case ("ohio", "barcelona", "minecraft") that the dictionary only knows with a
// capital, or not at all. Each is accepted by the English word check. Kept to whole names that are not also
// everyday Spanish or Catalan words, so nothing in the class's own languages slips through ("Como", "Luna" and
// "Mira" are English names too, and are not here). No imports, so the page and the worker share it.

const COUNTRIES = `afghanistan albania algeria andorra angola argentina armenia australia austria azerbaijan bahamas bahrain bangladesh
barbados belarus belgium belize benin bhutan bolivia bosnia botswana brazil brunei bulgaria burundi cambodia cameroon canada chad chile
china colombia comoros congo croatia cuba cyprus czechia denmark djibouti dominica ecuador egypt eritrea estonia eswatini ethiopia fiji
finland france gabon gambia georgia germany ghana greece grenada guatemala guinea guyana haiti honduras hungary iceland india indonesia
iran iraq ireland israel italy jamaica japan jordan kazakhstan kenya kiribati kosovo kuwait kyrgyzstan laos latvia lebanon lesotho
liberia libya liechtenstein lithuania luxembourg madagascar malawi malaysia maldives mali malta mauritania mauritius mexico micronesia
moldova monaco mongolia montenegro morocco mozambique myanmar namibia nauru nepal netherlands nicaragua niger nigeria norway oman
pakistan palau palestine panama paraguay peru philippines poland portugal qatar romania russia rwanda samoa senegal serbia seychelles
singapore slovakia slovenia somalia spain sudan suriname sweden switzerland syria taiwan tajikistan tanzania thailand togo tonga tunisia
turkey turkmenistan tuvalu uganda ukraine uruguay uzbekistan vanuatu vatican venezuela vietnam yemen zambia zimbabwe england scotland
wales britain america europe africa asia oceania antarctica catalonia catalunya andalusia galicia`;

const STATES = `alabama alaska arizona arkansas california colorado connecticut delaware florida hawaii idaho illinois indiana iowa kansas
kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon
pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming`;

const CITIES = `london paris madrid barcelona valencia sevilla seville bilbao malaga zaragoza tarragona girona lleida reus salou sitges ibiza
mallorca majorca tenerife rome milan venice naples berlin munich hamburg amsterdam brussels lisbon porto dublin vienna prague budapest
warsaw moscow istanbul athens cairo dubai tokyo osaka beijing shanghai seoul bangkok delhi mumbai sydney melbourne toronto vancouver
montreal chicago boston miami orlando seattle denver houston dallas atlanta detroit vegas hollywood manhattan brooklyn york quebec havana
bogota caracas quito marrakech casablanca rabat tangier fez dakar lagos nairobi johannesburg liverpool manchester`;

const APPS_AND_GAMES = `youtube youtuber youtubers minecraft fortnite roblox tiktok tiktoker instagram netflix spotify whatsapp snapchat discord
twitch google iphone ipad android samsung xbox playstation nintendo pokemon fifa nba nfl uefa disney marvel lego nike adidas mcdonalds
cocacola pepsi brawl clash`;

export const PROPER_NOUNS: ReadonlySet<string> = new Set(`${COUNTRIES} ${STATES} ${CITIES} ${APPS_AND_GAMES}`.split(/\s+/).filter(Boolean));
