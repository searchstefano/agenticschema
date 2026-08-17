import type { Profile } from '@agenticschema/core';

/**
 * Hand-written profiles for the types that actually turn up on the web. Anything
 * not listed here is covered by walking up the hierarchy (`Vehicle` to
 * `Product`) and, failing that, by the core's generic profile.
 *
 * `pick` is deliberately selective. Tipping every property into the agent's
 * context costs tokens and buries the fields that matter.
 */
export const PROFILES: readonly Profile[] = [
  {
    types: ['Product', 'IndividualProduct', 'ProductModel', 'ProductGroup'],
    slug: 'product',
    read: [
      {
        description: 'Details of the product on this page: name, description, image, SKU, brand, category.',
        pick: ['name', 'description', 'image', 'sku', 'mpn', 'gtin13', 'brand', 'category', 'color', 'material', 'size', 'model'],
      },
      {
        name: 'offer',
        from: 'offers',
        description: 'Price, currency, and availability of the product on this page.',
        pick: ['price', 'priceCurrency', 'availability', 'itemCondition', 'priceValidUntil', 'url', 'seller'],
      },
      {
        // A `ProductGroup` holds no `offers` of its own: the price of every size
        // and colour sits under `hasVariant`. Without this entry no price tool
        // is generated for such a page at all, and an agent asked what the
        // product costs is told the markup does not say — on a page carrying
        // thirteen prices. 46 of the 75 shop pages in the corpus are groups.
        //
        // Shops publish this both ways round, so both are named: the group's own
        // variants first, and failing that the siblings reached back through the
        // group when the page is about one variant.
        //
        // The variants themselves rather than their offers, which is the
        // difference between a list of prices and a list an agent can use.
        // `sku`, `color` and `size` live on the variant while the price lives a
        // hop below it, so returning the offers alone hands back thirteen
        // numbers with nothing to attach them to — and this description would be
        // promising something the payload does not contain.
        name: 'variants',
        from: ['hasVariant', 'isVariantOf.hasVariant'],
        list: true,
        description:
          'Each variant (size, colour) of the product on this page, with its own price and availability.',
        pick: ['name', 'sku', 'color', 'size', 'material', 'offers'],
      },
      {
        // Two shapes, one tool. A variant's own rating comes first because it is
        // what the page is about; the group's is the fallback, and it is where
        // shops usually keep the reviews. Patagonia publishes `ratingValue:
        // 4.45, reviewCount: 147` on the group while the page is about a single
        // variant, and an agent asked for the rating was told there was none.
        //
        // Candidates rather than two entries, on purpose: a page carrying both
        // produced `get_product_rating` and `get_product_rating_2`, identical in
        // description, and an agent has no way to choose between them.
        name: 'rating',
        from: ['aggregateRating', 'isVariantOf.aggregateRating'],
        description: 'Aggregate customer rating of the product on this page.',
      },
      { name: 'reviews', from: 'review', list: true, description: 'Individual customer reviews of the product.' },
    ],
  },
  {
    types: ['Offer', 'AggregateOffer'],
    slug: 'offer',
    read: [
      {
        description: 'Price, currency, and availability of the offer on this page.',
        pick: ['price', 'priceCurrency', 'lowPrice', 'highPrice', 'offerCount', 'availability', 'itemCondition', 'url'],
      },
    ],
  },
  {
    types: ['Article', 'NewsArticle', 'BlogPosting', 'TechArticle', 'Report', 'ScholarlyArticle'],
    slug: 'article',
    read: [
      {
        description: 'The article on this page: headline, summary, publication dates, section.',
        pick: ['headline', 'alternativeHeadline', 'description', 'image', 'datePublished', 'dateModified', 'articleSection', 'keywords', 'wordCount', 'inLanguage', 'url'],
      },
      { name: 'author', from: 'author', list: true, description: 'Author or authors of the article.' },
      { name: 'publisher', from: 'publisher', description: 'Publisher of the article.' },
    ],
  },
  {
    types: ['FAQPage'],
    slug: 'faq',
    read: [
      { name: 'questions', from: 'mainEntity', list: true, description: 'Frequently asked questions and their answers from this page.' },
    ],
  },
  {
    types: ['QAPage'],
    slug: 'qa',
    read: [{ name: 'question', from: 'mainEntity', description: 'The question and its answers from this page.' }],
  },
  {
    types: ['Question'],
    slug: 'question',
    read: [
      { description: 'The question on this page.', pick: ['name', 'text', 'answerCount', 'upvoteCount'] },
      { name: 'answers', from: 'acceptedAnswer', list: true, description: 'Accepted answers to the question.' },
    ],
  },
  {
    types: ['Event', 'BusinessEvent', 'MusicEvent', 'SportsEvent', 'TheaterEvent', 'EducationEvent'],
    slug: 'event',
    read: [
      {
        description: 'The event on this page: name, description, start and end dates, status.',
        pick: ['name', 'description', 'image', 'startDate', 'endDate', 'doorTime', 'eventStatus', 'eventAttendanceMode', 'inLanguage', 'url'],
      },
      { name: 'location', from: 'location', description: 'Where the event takes place.' },
      { name: 'tickets', from: 'offers', list: true, description: 'Ticket prices and availability for the event.' },
      { name: 'performers', from: 'performer', list: true, description: 'Performers at the event.' },
    ],
  },
  {
    types: ['LocalBusiness', 'Restaurant', 'Store', 'Hotel', 'MedicalBusiness', 'ProfessionalService', 'FoodEstablishment'],
    slug: 'business',
    read: [
      {
        description: 'The business on this page: name, contact details, price range.',
        pick: ['name', 'description', 'image', 'telephone', 'email', 'faxNumber', 'priceRange', 'currenciesAccepted', 'paymentAccepted', 'url', 'servesCuisine'],
      },
      { name: 'address', from: 'address', description: 'Postal address of the business.' },
      { name: 'hours', from: 'openingHoursSpecification', list: true, description: 'Opening hours of the business, per day of week.' },
      { name: 'geo', from: 'geo', description: 'Geographic coordinates of the business.' },
      { name: 'rating', from: 'aggregateRating', description: 'Aggregate customer rating of the business.' },
    ],
  },
  {
    types: ['Recipe'],
    slug: 'recipe',
    read: [
      {
        description: 'The recipe on this page: ingredients, instructions, times, yield.',
        pick: ['name', 'description', 'image', 'recipeYield', 'prepTime', 'cookTime', 'totalTime', 'recipeCategory', 'recipeCuisine', 'recipeIngredient', 'recipeInstructions', 'suitableForDiet'],
      },
      { name: 'nutrition', from: 'nutrition', description: 'Nutritional information for the recipe.' },
      { name: 'rating', from: 'aggregateRating', description: 'Aggregate rating of the recipe.' },
    ],
  },
  {
    types: ['HowTo'],
    slug: 'howto',
    read: [
      {
        description: 'The how-to guide on this page: goal, total time, estimated cost.',
        pick: ['name', 'description', 'totalTime', 'prepTime', 'estimatedCost', 'yield'],
      },
      { name: 'steps', from: 'step', list: true, description: 'Ordered steps of the how-to guide.' },
      { name: 'supplies', from: 'supply', list: true, description: 'Supplies needed for the how-to guide.' },
      { name: 'tools', from: 'tool', list: true, description: 'Tools needed for the how-to guide.' },
    ],
  },
  {
    types: ['JobPosting'],
    slug: 'job',
    read: [
      {
        description: 'The job posting on this page: title, description, employment type, dates.',
        pick: ['title', 'description', 'employmentType', 'datePosted', 'validThrough', 'jobBenefits', 'workHours', 'experienceRequirements', 'educationRequirements'],
      },
      { name: 'employer', from: 'hiringOrganization', description: 'Organization hiring for this position.' },
      { name: 'location', from: 'jobLocation', list: true, description: 'Where the job is located.' },
      { name: 'salary', from: 'baseSalary', description: 'Base salary offered for this position.' },
    ],
  },
  {
    types: ['Course'],
    slug: 'course',
    read: [
      {
        description: 'The course on this page: name, description, code, prerequisites.',
        pick: ['name', 'description', 'image', 'courseCode', 'coursePrerequisites', 'educationalCredentialAwarded', 'inLanguage', 'timeRequired'],
      },
      { name: 'provider', from: 'provider', description: 'Institution providing the course.' },
      { name: 'instances', from: 'hasCourseInstance', list: true, description: 'Scheduled instances of the course.' },
    ],
  },
  {
    types: ['SoftwareApplication', 'WebApplication', 'MobileApplication', 'VideoGame'],
    slug: 'application',
    read: [
      {
        description: 'The software application on this page: name, category, platform, version.',
        pick: ['name', 'description', 'image', 'applicationCategory', 'applicationSubCategory', 'operatingSystem', 'softwareVersion', 'fileSize', 'downloadUrl', 'permissions'],
      },
      { name: 'offer', from: 'offers', description: 'Price and availability of the application.' },
      { name: 'rating', from: 'aggregateRating', description: 'Aggregate user rating of the application.' },
    ],
  },
  {
    types: ['VideoObject', 'AudioObject', 'MediaObject'],
    slug: 'media',
    read: [
      {
        description: 'The media object on this page: title, duration, upload date, URLs.',
        pick: ['name', 'description', 'uploadDate', 'duration', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'width', 'height', 'encodingFormat', 'transcript'],
      },
    ],
  },
  {
    types: ['Person'],
    slug: 'person',
    read: [
      {
        description: 'The person described on this page: name, role, contact details, profiles.',
        pick: ['name', 'givenName', 'familyName', 'jobTitle', 'description', 'image', 'email', 'telephone', 'url', 'sameAs', 'knowsLanguage', 'nationality'],
      },
      { name: 'employer', from: 'worksFor', description: 'Organization the person works for.' },
      { name: 'address', from: 'address', description: 'Address of the person.' },
    ],
  },
  {
    types: ['Organization', 'Corporation', 'NGO', 'EducationalOrganization', 'GovernmentOrganization'],
    slug: 'organization',
    read: [
      {
        description: 'The organization described on this page: name, contact details, identifiers.',
        pick: ['name', 'legalName', 'alternateName', 'description', 'logo', 'image', 'url', 'telephone', 'email', 'sameAs', 'vatID', 'taxID', 'foundingDate', 'numberOfEmployees'],
      },
      { name: 'address', from: 'address', description: 'Postal address of the organization.' },
      { name: 'contacts', from: 'contactPoint', list: true, description: 'Contact points of the organization.' },
    ],
  },
  {
    types: ['BreadcrumbList'],
    slug: 'breadcrumbs',
    read: [
      { from: 'itemListElement', list: true, description: 'Breadcrumb trail showing where this page sits in the site hierarchy.' },
    ],
  },
  {
    types: ['Review', 'CriticReview', 'UserReview'],
    slug: 'review',
    read: [
      {
        description: 'The review on this page: body, title, publication date.',
        pick: ['name', 'reviewBody', 'datePublished', 'inLanguage'],
      },
      { name: 'rating', from: 'reviewRating', description: 'Rating given by this review.' },
      { name: 'author', from: 'author', description: 'Author of the review.' },
      { name: 'subject', from: 'itemReviewed', description: 'The item being reviewed.' },
    ],
  },
  {
    types: ['AggregateRating', 'Rating'],
    slug: 'rating',
    read: [
      {
        description: 'Aggregate rating: score, scale, and how many ratings it is based on.',
        pick: ['ratingValue', 'bestRating', 'worstRating', 'ratingCount', 'reviewCount'],
      },
    ],
  },
  {
    types: ['Book', 'Audiobook'],
    slug: 'book',
    read: [
      {
        description: 'The book on this page: title, ISBN, edition, format, page count.',
        pick: ['name', 'description', 'image', 'isbn', 'bookEdition', 'bookFormat', 'numberOfPages', 'datePublished', 'inLanguage', 'genre'],
      },
      { name: 'author', from: 'author', list: true, description: 'Author or authors of the book.' },
      { name: 'publisher', from: 'publisher', description: 'Publisher of the book.' },
    ],
  },
  {
    types: ['Movie', 'TVSeries', 'TVEpisode'],
    slug: 'movie',
    read: [
      {
        description: 'The film or show on this page: title, duration, genre, content rating.',
        pick: ['name', 'description', 'image', 'duration', 'dateCreated', 'datePublished', 'contentRating', 'genre', 'inLanguage', 'countryOfOrigin'],
      },
      { name: 'directors', from: 'director', list: true, description: 'Directors of the film or show.' },
      { name: 'cast', from: 'actor', list: true, description: 'Cast of the film or show.' },
      { name: 'rating', from: 'aggregateRating', description: 'Aggregate viewer rating.' },
    ],
  },
  {
    types: ['Dataset'],
    slug: 'dataset',
    read: [
      {
        description: 'The dataset on this page: name, description, licence, coverage, keywords.',
        pick: ['name', 'description', 'license', 'keywords', 'temporalCoverage', 'spatialCoverage', 'measurementTechnique', 'variableMeasured', 'version'],
      },
      { name: 'distributions', from: 'distribution', list: true, description: 'Downloadable distributions of the dataset.' },
      { name: 'creator', from: 'creator', description: 'Creator of the dataset.' },
    ],
  },
  {
    types: ['Accommodation', 'Residence', 'SingleFamilyResidence', 'Apartment', 'House'],
    slug: 'property',
    read: [
      {
        description: 'The property on this page: size, rooms, amenities.',
        pick: ['name', 'description', 'image', 'floorSize', 'numberOfRooms', 'numberOfBedrooms', 'numberOfBathroomsTotal', 'yearBuilt', 'petsAllowed', 'amenityFeature'],
      },
      { name: 'address', from: 'address', description: 'Address of the property.' },
      { name: 'geo', from: 'geo', description: 'Geographic coordinates of the property.' },
    ],
  },
];
