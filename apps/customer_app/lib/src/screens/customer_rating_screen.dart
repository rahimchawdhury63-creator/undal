/// Verified-order customer rating form and state (`c-28`).
///
/// Ratings are submitted to W1 only for server-confirmed delivered orders; kitchen and rider scores
/// are independent mutations so a network retry cannot hide a successful first submission.
library;

import 'package:flutter/material.dart';
import 'package:undal_core/undal_core.dart';

import '../i18n/customer_copy.dart';
import '../models/customer_experience_models.dart';
import '../state/customer_controller.dart';
import '../state/customer_experience_state.dart';

/// Post-delivery vendor and optional assigned-rider rating form (`c-28`).
class CustomerRatingScreen extends StatefulWidget {
  /// Creates a verified-order rating screen.
  const CustomerRatingScreen({super.key, required this.controller});

  /// Root customer controller.
  final CustomerController controller;

  @override
  State<CustomerRatingScreen> createState() => _CustomerRatingScreenState();
}

class _CustomerRatingScreenState extends State<CustomerRatingScreen> {
  int _vendorStars = 5;
  int _riderStars = 5;
  final Set<String> _vendorTags = <String>{};
  final Set<String> _riderTags = <String>{};
  final TextEditingController _comment = TextEditingController();
  bool _vendorSubmitted = false;
  bool _riderSubmitted = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
      if (!mounted) return;
      final CustomerOrderDetail? detail = widget.controller.experience.orderDetail;
      if (detail != null && detail.summary.status == 'DELIVERED') {
        widget.controller.experience.loadOrderReviews(detail.summary.id);
      }
    });
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CustomerOrderDetail? detail = widget.controller.experience.orderDetail;
    final List<CustomerReviewSnapshot> reviews = widget.controller.experience.orderReviews;
    CustomerReviewSnapshot? reviewFor(String direction) {
      for (final CustomerReviewSnapshot row in reviews) {
        if (row.direction == direction) return row;
      }
      return null;
    }
    final CustomerReviewSnapshot? vendorReview = reviewFor('customer_to_vendor');
    final CustomerReviewSnapshot? riderReview = reviewFor('customer_to_rider');
    final String lang = Localizations.localeOf(context).languageCode;
    if (detail == null || detail.summary.status != 'DELIVERED') {
      return _RatingUnavailable(
        onBack: () => widget.controller.returnFromCustomerExperience(tabIndex: 2),
      );
    }
    return Scaffold(
      key: const ValueKey<String>('screen-c-28'),
      appBar: AppBar(title: Text(cText(context, 'Rate your order', 'অর্ডার রেট করুন')), leading: BackButton(onPressed: () => widget.controller.returnFromCustomerExperience(tabIndex: 2))),
      body: ListView(padding: const EdgeInsets.all(UndalSpacingTokens.md), children: <Widget>[
        Text(detail.summary.vendorName(lang), style: Theme.of(context).textTheme.titleLarge),
        if (widget.controller.experience.orderReviewsLoading && reviews.isEmpty) const LinearProgressIndicator(),
        if (widget.controller.experience.orderReviewsError != null && reviews.isEmpty)
          Text(cText(context, 'Saved ratings could not be loaded. Refresh before submitting another rating.', 'আগের রেটিং লোড হয়নি। নতুন রেটিং দেওয়ার আগে রিফ্রেশ করুন।'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        _RatingPanel(
          title: cText(context, 'Kitchen', 'রান্নাঘর'),
          stars: vendorReview?.rating ?? _vendorStars,
          tags: _vendorTags,
          onStars: (int value) => setState(() => _vendorStars = value),
          onTags: (String value) => setState(() => _toggleTag(_vendorTags, value)),
          submitted: _vendorSubmitted || vendorReview != null,
          busy: _busy,
          onSubmit: () => _submit('customer_to_vendor'),
        ),
        if (detail.summary.riderId != null)
          _RatingPanel(
            title: cText(context, 'Rider', 'রাইডার'),
            stars: riderReview?.rating ?? _riderStars,
            tags: _riderTags,
            onStars: (int value) => setState(() => _riderStars = value),
            onTags: (String value) => setState(() => _toggleTag(_riderTags, value)),
            submitted: _riderSubmitted || riderReview != null,
            busy: _busy,
            onSubmit: () => _submit('customer_to_rider'),
          ),
        TextField(controller: _comment, maxLength: 1000, maxLines: 4, decoration: InputDecoration(labelText: cText(context, 'Comment (optional)', 'মন্তব্য (ঐচ্ছিক)'))),
        const SizedBox(height: UndalSpacingTokens.md),
        Text(cText(context, 'Ratings are attached to this verified delivered order.', 'রেটিংটি এই যাচাইকৃত ডেলিভারি অর্ডারের সঙ্গে যুক্ত হবে।')),
      ]),
    );
  }

  Future<void> _submit(String direction) async {
    final CustomerOrderDetail? detail = widget.controller.experience.orderDetail;
    if (detail == null || _busy) return;
    setState(() => _busy = true);
    final bool success = await widget.controller.experience.submitRating(
      orderId: detail.summary.id,
      rating: direction == 'customer_to_vendor' ? _vendorStars : _riderStars,
      direction: direction,
      aspectTags: (direction == 'customer_to_vendor' ? _vendorTags : _riderTags).toList(),
      comment: _comment.text,
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (success && direction == 'customer_to_vendor') _vendorSubmitted = true;
      if (success && direction == 'customer_to_rider') _riderSubmitted = true;
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(success
        ? cText(context, 'Rating saved.', 'রেটিং সংরক্ষিত হয়েছে।')
        : cText(context, 'Rating could not be saved. Try again after reconnecting.', 'রেটিং সংরক্ষণ হয়নি। সংযোগ চালু করে আবার চেষ্টা করুন।'))));
  }

  void _toggleTag(Set<String> set, String value) { if (!set.add(value)) set.remove(value); }
}

class _RatingPanel extends StatelessWidget {
  const _RatingPanel({required this.title, required this.stars, required this.tags, required this.onStars, required this.onTags, required this.submitted, required this.busy, required this.onSubmit});
  final String title;
  final int stars;
  final Set<String> tags;
  final ValueChanged<int> onStars;
  final ValueChanged<String> onTags;
  final bool submitted;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final List<(String, String)> choices = <(String, String)>[
      ('fresh', cText(context, 'Fresh', 'তাজা')),
      ('taste', cText(context, 'Great taste', 'দারুণ স্বাদ')),
      ('careful', cText(context, 'Careful service', 'যত্নশীল সেবা')),
      ('on_time', cText(context, 'On time', 'সময়মতো')),
    ];
    return Card(elevation: 0, child: Padding(padding: const EdgeInsets.all(UndalSpacingTokens.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
      Text(title, style: Theme.of(context).textTheme.titleMedium),
      Wrap(children: List<Widget>.generate(5, (int i) => IconButton(
        key: ValueKey<String>('rating-star-${title.toLowerCase()}-${i + 1}'),
        tooltip: '${i + 1} ${cText(context, 'stars', 'তারকা')}',
        onPressed: submitted || busy ? null : () => onStars(i + 1),
        icon: Icon(i < stars ? Icons.star : Icons.star_border, color: Colors.amber.shade700),
      ))),
      Wrap(spacing: UndalSpacingTokens.xs, children: choices.map(((String, String) item) => FilterChip(
        label: Text(item.$2), selected: tags.contains(item.$1), onSelected: submitted || busy ? null : (_) => onTags(item.$1),
      )).toList()),
      const SizedBox(height: UndalSpacingTokens.xs),
      FilledButton(onPressed: submitted || busy ? null : onSubmit, child: Text(submitted ? cText(context, 'Saved', 'সংরক্ষিত') : cText(context, 'Submit rating', 'রেটিং পাঠান'))),
    ])));
  }
}


class _RatingUnavailable extends StatelessWidget {
  const _RatingUnavailable({required this.onBack});
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
        key: const ValueKey<String>('screen-c-28'),
        appBar: AppBar(title: Text(cText(context, 'Rate your order', 'অর্ডার রেট করুন'))),
        body: Center(child: Padding(
          padding: const EdgeInsets.all(UndalSpacingTokens.xl),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            Text(cText(context, 'Only a server-confirmed delivered order can be rated.', 'সার্ভারে ডেলিভারি নিশ্চিত হওয়া অর্ডারেই রেটিং দেওয়া যায়।'), textAlign: TextAlign.center),
            const SizedBox(height: UndalSpacingTokens.md),
            FilledButton(onPressed: onBack, child: Text(cText(context, 'Back to orders', 'অর্ডারে ফিরুন'))),
          ]),
        )),
      );
}
