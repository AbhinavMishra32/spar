/**
 * The GraphQL LeetCode actually answers.
 *
 * Adapted from the two open-source clients that keep these working in the field —
 * kawre/leetcode.nvim's `lua/leetcode/api/queries.lua` and
 * jinzcdev/leetcode-mcp-server's `src/leetcode/graphql/**` — rather than derived
 * from the schema, because LeetCode's schema is not published and the useful
 * field set is folklore. Aliases are kept minimal here and the renaming is done
 * in `normalize.ts`: an alias that drifts from the wire name makes the next
 * schema change unreadable.
 *
 * The CN service diverges in three places, and each divergence has a comment on
 * it. Everything not commented is identical on both.
 */

/** Who is asking. The one query that answers whether the stored cookie is still
 *  worth anything, which makes it the connection check as well. */
/* Exactly the fields leetcode.nvim asks for and no more.
 *
 * GraphQL fails a query whole: one field the schema does not define and the
 * response is an `errors` array with no data in it, which reads downstream as a
 * session LeetCode refused rather than as a query Spar got wrong. That is
 * precisely what asking for `avatar` and `activeSessionId` here produced — a
 * sign-in that completed, stored a perfectly good cookie, and was then reported
 * as not accepted. So this document is held to what a client that runs against
 * the live service every day actually asks for, and nothing is added to it for
 * decoration. */
export const USER_STATUS_QUERY = `
query globalData {
  userStatus {
    userId
    username
    isSignedIn
    isPremium
    isVerified
  }
}`;

/* CN answers `userStatus` without `userId`; the account's identity there is the
   slug. Asking for a field the service does not define fails the whole query, so
   the two are separate documents rather than one with optional fields. */
export const USER_STATUS_QUERY_CN = `
query globalData {
  userStatus {
    username
    userSlug
    isSignedIn
    isPremium
    isVerified
  }
}`;

/** Everything about one problem that a challenge can be mounted from. */
export const PROBLEM_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    isPaidOnly
    difficulty
    likes
    dislikes
    categoryTitle
    content
    status
    acRate
    stats
    hints
    metaData
    exampleTestcaseList
    codeSnippets { lang langSlug code }
    topicTags { name slug }
    similarQuestionList { difficulty titleSlug title isPaidOnly }
  }
}`;

/* CN has no `similarQuestionList` and no `acRate` on the question node; the
   relations arrive as a JSON string in `similarQuestions`, and the translated
   title and statement are separate fields. */
export const PROBLEM_QUERY_CN = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    translatedTitle
    titleSlug
    isPaidOnly
    difficulty
    likes
    dislikes
    categoryTitle
    content
    translatedContent
    status
    stats
    hints
    metaData
    exampleTestcaseList
    codeSnippets { lang langSlug code }
    topicTags { name slug translatedName }
    similarQuestions
  }
}`;

/**
 * Problem search. `filters` is a `QuestionListFilterInput`, which accepts
 * `tags`, `difficulty`, `searchKeywords` and `status` — and quietly ignores a
 * key it does not know, so an unsupported filter reads as an unfiltered result
 * rather than an error. The caller checks its own filters, not the server.
 */
export const SEARCH_PROBLEMS_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    total: totalNum
    questions: data {
      questionId
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      acRate
      status
      topicTags { slug }
    }
  }
}`;

/** Today's problem, which is the one thing every learner is offered in common. */
export const DAILY_QUESTION_QUERY = `
query questionOfToday {
  activeDailyCodingChallengeQuestion {
    date
    link
    question { titleSlug title difficulty }
  }
}`;

/** A random problem inside a filter, for when the agent wants novelty rather
 *  than a specific problem. Returns only the slug, so it is always followed by
 *  a problem read. */
export const RANDOM_QUESTION_QUERY = `
query randomQuestion($categorySlug: String, $filters: QuestionListFilterInput) {
  randomQuestion(categorySlug: $categorySlug, filters: $filters) { titleSlug isPaidOnly }
}`;

/** Solve counts, overall and by difficulty, plus what exists to be solved. Both
 *  halves matter: 40 mediums means nothing without how many mediums there are. */
export const SOLVED_COUNTS_QUERY = `
query userProblemsSolved($username: String!) {
  allQuestionsCount { difficulty count }
  matchedUser(username: $username) {
    problemsSolvedBeatsStats { difficulty percentage }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;

/** Per-tag solve counts in LeetCode's own three bands. The closest thing the
 *  source has to an opinion about the learner's strengths. */
export const SKILL_STATS_QUERY = `
query skillStats($username: String!) {
  matchedUser(username: $username) {
    tagProblemCounts {
      advanced { tagName tagSlug problemsSolved }
      intermediate { tagName tagSlug problemsSolved }
      fundamental { tagName tagSlug problemsSolved }
    }
  }
}`;

export const STREAK_QUERY = `
query getStreakCounter {
  streakCounter { streakCount daysSkipped currentDayCompleted }
}`;

/** The learner's own submissions, newest first, optionally for one problem. Only
 *  answered while authenticated, and only ever about the signed-in account. */
export const SUBMISSION_LIST_QUERY = `
query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!, $lang: Int, $status: Int) {
  questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug, lang: $lang, status: $status) {
    lastKey
    hasNext
    submissions {
      id
      title
      titleSlug
      statusDisplay
      lang
      runtime
      memory
      timestamp
      isPending
    }
  }
}`;

/** One submission in full, which is the only way to get the code back. */
export const SUBMISSION_DETAIL_QUERY = `
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    lang { name verboseName }
    runtime
    runtimeDisplay
    runtimePercentile
    memory
    memoryDisplay
    memoryPercentile
    statusCode
    timestamp
    totalCorrect
    totalTestcases
    question { titleSlug title questionId }
  }
}`;

/** Progress across problems the learner has touched, filtered by status. Used to
 *  answer "what did they attempt and never finish", which is the most useful
 *  thing an external source knows that Spar's own ledger cannot. */
export const PROGRESS_QUESTIONS_QUERY = `
query userProgressQuestionList($filters: UserProgressQuestionListInput) {
  userProgressQuestionList(filters: $filters) {
    totalNum
    questions {
      titleSlug
      title
      difficulty
      lastSubmittedAt
      questionStatus
      lastResult
      topicTags { slug }
    }
  }
}`;
